import zxcvbn from "zxcvbn";

/**
 * Password policy for the Itau BBA Dashboard (B2B client access).
 *
 * NOTE: Client-side validation is UX only — backend enforcement lives in
 * Supabase Auth settings. The CTO must mirror these requirements in
 * Supabase Dashboard -> Authentication -> Policies -> Password Requirements:
 *   - Min Length: 12
 *   - Require lowercase, uppercase, digits, special chars (recommended)
 *   - Reject common passwords (built-in)
 */

export const MIN_LENGTH = 12;
export const MIN_SCORE = 3; // zxcvbn 0-4 (0=very weak, 4=very strong)

export type StrengthResult = {
  ok: boolean;
  score: number; // 0-4
  message: string;
  suggestions: string[];
};

export function checkStrength(password: string): StrengthResult {
  if (!password) return { ok: false, score: 0, message: "Required", suggestions: [] };
  if (password.length < MIN_LENGTH)
    return {
      ok: false,
      score: 0,
      message: `Must be at least ${MIN_LENGTH} characters.`,
      suggestions: [],
    };
  const result = zxcvbn(password);
  return {
    ok: result.score >= MIN_SCORE,
    score: result.score,
    message: result.score < MIN_SCORE ? "Too weak. Add length or complexity." : "Strong",
    suggestions: result.feedback.suggestions,
  };
}

export function scoreLabel(score: number): string {
  return ["Very weak", "Weak", "Fair", "Good", "Strong"][score] ?? "Unknown";
}
