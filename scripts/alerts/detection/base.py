"""
Base classes for the Alerts Product detection layer.

Contract:
- Each detector reads state from the Supabase DB (alert_events + source tables).
- detect() returns a list of DetectedEvent (may be empty).
- Idempotency is guaranteed by the UNIQUE(source_slug, event_key) constraint in
  alert_events — detectors do NOT check for duplicates themselves.
- Detectors NEVER send email. Email is sent exclusively by delivery/send_outbox.py.
- Errors from external sources are caught and logged; an empty list is returned.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import ClassVar

logger = logging.getLogger(__name__)

# Global registry: source_slug -> detector class
DETECTOR_REGISTRY: dict[str, type["BaseDetector"]] = {}


class _DetectorMeta(type(ABC)):
    """Metaclass that auto-registers concrete detector classes."""

    def __new__(mcs, name: str, bases: tuple, namespace: dict):
        cls = super().__new__(mcs, name, bases, namespace)
        slug = namespace.get("source_slug")
        if slug and not namespace.get("__abstract__", False):
            DETECTOR_REGISTRY[slug] = cls
        return cls


class BaseDetector(ABC, metaclass=_DetectorMeta):
    """
    Abstract base for all source detectors.

    Subclasses must set:
        source_slug: str  — must match alert_sources.source_slug exactly.

    Subclasses must implement:
        detect() -> list[DetectedEvent]
    """

    source_slug: ClassVar[str]
    __abstract__ = True  # Do not register the base class itself

    @abstractmethod
    def detect(self) -> list["DetectedEvent"]:
        """
        Detect new events for this source.

        Returns a (possibly empty) list of DetectedEvent.
        Each DetectedEvent will become one row in alert_events (idempotent via
        the UNIQUE(source_slug, event_key) constraint — duplicates are silently
        skipped with ON CONFLICT DO NOTHING).

        Must NOT raise on external failures — log and return [].
        """
        ...

    def safe_detect(self) -> list["DetectedEvent"]:
        """Wrapper that catches all exceptions and returns [] on failure."""
        try:
            return self.detect()
        except Exception as exc:
            logger.error(
                "Detector %s raised an unexpected error: %s",
                self.__class__.__name__,
                exc,
                exc_info=True,
            )
            return []


@dataclass
class DetectedEvent:
    """
    A single detected update from a source.

    Attributes:
        event_key: Unique key within the source. Combined with source_slug forms
                   the idempotency anchor in alert_events.
        payload:   Rich metadata dict (period, urls, message, etc.) stored as
                   JSONB in alert_events.payload.
    """

    event_key: str
    payload: dict = field(default_factory=dict)
