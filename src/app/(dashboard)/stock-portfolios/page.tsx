"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";

import NavBar from "../../../components/NavBar";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useStockPortfolios } from "../../../hooks/useStockPortfolios";

const StockSearch = dynamic(() => import("../../../components/stocks/StockSearch"), { ssr: false });

export default function StockPortfoliosPage() {
  const { visible, loading: guardLoading } = useModuleVisibilityGuard("stocks");
  const {
    portfolios,
    activePortfolio,
    isLoading,
    createPortfolio,
    updatePortfolio,
    deletePortfolio,
    setActivePortfolio,
  } = useStockPortfolios();

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [tickers, setTickers] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setTickers([]);
    setShowModal(true);
  };

  const openEdit = (id: string) => {
    const p = portfolios.find((x) => x.id === id);
    if (!p) return;
    setEditingId(id);
    setName(p.name);
    setTickers([...p.tickers]);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    if (editingId) {
      await updatePortfolio(editingId, { name: name.trim(), tickers });
    } else {
      await createPortfolio(name.trim(), tickers);
    }
    setSaving(false);
    setShowModal(false);
  };

  const handleDelete = async (id: string) => {
    await deletePortfolio(id);
    setDeletingId(null);
  };

  const handleAddTicker = useCallback(
    (symbol: string) => {
      if (!tickers.includes(symbol)) {
        setTickers((prev) => [...prev, symbol]);
      }
    },
    [tickers],
  );

  const handleRemoveTicker = (symbol: string) => {
    setTickers((prev) => prev.filter((t) => t !== symbol));
  };

  if (guardLoading || !visible) return null;

  return (
    <>
      <NavBar />
      <main className="container-fluid" style={{ padding: "24px 32px", maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h4 style={{ margin: 0, fontWeight: 700 }}>Minhas Carteiras</h4>
          <button
            className="btn btn-sm"
            style={{ background: "#ff5000", color: "#fff", fontWeight: 600, borderRadius: 8 }}
            onClick={openCreate}
          >
            + Nova Carteira
          </button>
        </div>

        {isLoading ? (
          <div className="text-center py-5">
            <span className="spinner-border spinner-border-sm" />
          </div>
        ) : portfolios.length === 0 ? (
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 40,
              textAlign: "center",
              color: "#888",
            }}
          >
            <p style={{ fontSize: 16, marginBottom: 12 }}>Nenhuma carteira criada.</p>
            <button
              className="btn"
              style={{ color: "#ff5000", fontWeight: 600 }}
              onClick={openCreate}
            >
              Criar minha primeira carteira
            </button>
          </div>
        ) : (
          <div className="row g-3">
            {portfolios.map((p) => (
              <div key={p.id} className="col-12">
                <div
                  style={{
                    background: "#fff",
                    borderRadius: 12,
                    padding: "16px 20px",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                    borderLeft: p.is_active ? "4px solid #ff5000" : "4px solid transparent",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <h6 style={{ margin: 0, fontWeight: 700 }}>{p.name}</h6>
                        {p.is_active && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              background: "#ff5000",
                              color: "#fff",
                              padding: "2px 8px",
                              borderRadius: 12,
                              textTransform: "uppercase",
                            }}
                          >
                            ATIVA
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
                        {p.tickers.length} {p.tickers.length === 1 ? "acao" : "acoes"}
                      </div>
                      {/* Ticker chips */}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                        {p.tickers.map((t) => (
                          <span
                            key={t}
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              background: "#f3f4f6",
                              padding: "2px 10px",
                              borderRadius: 12,
                              color: "#333",
                            }}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {!p.is_active && (
                        <button
                          className="btn btn-sm"
                          style={{
                            background: "#fff7ed",
                            color: "#ff5000",
                            fontWeight: 600,
                            fontSize: 12,
                            borderRadius: 6,
                            border: "1px solid #ff500030",
                          }}
                          onClick={() => setActivePortfolio(p.id)}
                        >
                          Ativar
                        </button>
                      )}
                      <button
                        className="btn btn-sm"
                        style={{
                          background: "#f3f4f6",
                          color: "#333",
                          fontWeight: 600,
                          fontSize: 12,
                          borderRadius: 6,
                          border: "none",
                        }}
                        onClick={() => openEdit(p.id)}
                      >
                        Editar
                      </button>
                      {deletingId === p.id ? (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            className="btn btn-sm"
                            style={{
                              background: "#dc2626",
                              color: "#fff",
                              fontWeight: 600,
                              fontSize: 12,
                              borderRadius: 6,
                              border: "none",
                            }}
                            onClick={() => handleDelete(p.id)}
                          >
                            Confirmar
                          </button>
                          <button
                            className="btn btn-sm"
                            style={{
                              background: "#f3f4f6",
                              color: "#333",
                              fontWeight: 600,
                              fontSize: 12,
                              borderRadius: 6,
                              border: "none",
                            }}
                            onClick={() => setDeletingId(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn btn-sm"
                          style={{
                            background: "#fef2f2",
                            color: "#dc2626",
                            fontWeight: 600,
                            fontSize: 12,
                            borderRadius: 6,
                            border: "none",
                          }}
                          onClick={() => setDeletingId(p.id)}
                        >
                          Excluir
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal */}
        {showModal && (
          <>
            <div
              className="modal-backdrop show"
              style={{ zIndex: 1040 }}
              onClick={() => setShowModal(false)}
            />
            <div
              className="modal d-block"
              style={{ zIndex: 1050 }}
              onClick={() => setShowModal(false)}
            >
              <div
                className="modal-dialog modal-dialog-centered"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-content" style={{ borderRadius: 16 }}>
                  <div className="modal-header" style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <h5 className="modal-title" style={{ fontWeight: 700 }}>
                      {editingId ? "Editar Carteira" : "Nova Carteira"}
                    </h5>
                    <button
                      type="button"
                      className="btn-close"
                      onClick={() => setShowModal(false)}
                    />
                  </div>
                  <div className="modal-body">
                    <div className="mb-3">
                      <label className="form-label" style={{ fontWeight: 600, fontSize: 13 }}>
                        Nome da Carteira
                      </label>
                      <input
                        type="text"
                        className="form-control"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ex: Minha Carteira B3"
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label" style={{ fontWeight: 600, fontSize: 13 }}>
                        Acoes
                      </label>
                      <StockSearch onSelect={handleAddTicker} placeholder="Buscar e adicionar acao..." />
                      {tickers.length > 0 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                          {tickers.map((t) => (
                            <span
                              key={t}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 12,
                                fontWeight: 600,
                                background: "#f3f4f6",
                                padding: "4px 10px",
                                borderRadius: 12,
                                color: "#333",
                              }}
                            >
                              {t}
                              <button
                                onClick={() => handleRemoveTicker(t)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: "#888",
                                  cursor: "pointer",
                                  padding: 0,
                                  fontSize: 14,
                                  lineHeight: 1,
                                }}
                              >
                                x
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="modal-footer" style={{ borderTop: "1px solid #f3f4f6" }}>
                    <button
                      className="btn"
                      style={{ color: "#888", fontWeight: 600 }}
                      onClick={() => setShowModal(false)}
                    >
                      Cancelar
                    </button>
                    <button
                      className="btn"
                      style={{
                        background: "#ff5000",
                        color: "#fff",
                        fontWeight: 600,
                        borderRadius: 8,
                      }}
                      onClick={handleSave}
                      disabled={saving || !name.trim()}
                    >
                      {saving ? (
                        <span className="spinner-border spinner-border-sm" />
                      ) : editingId ? (
                        "Salvar"
                      ) : (
                        "Criar"
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
