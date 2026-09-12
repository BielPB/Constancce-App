const AUTH_SESSION_KEY = "constancia_auth_session";

export const ACCENT_PRESETS = {
  green: { brass: "#69D36F", dim: "#397B42" },
  pink: { brass: "#F06DA8", dim: "#914468" },
  blue: { brass: "#5B9CFF", dim: "#365E9C" },
  purple: { brass: "#A77BFF", dim: "#63499B" },
};

export function accentInkColor(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex || "");
  if (!m) return "#141208";
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 140 ? "#141208" : "#F5F5F0";
}

// Lê o tema de acento salvo localmente (fora do React), pra telas que renderizam
// antes/fora da árvore normal do app — ex.: o fallback do ErrorBoundary, que
// precisa continuar funcionando mesmo se o crash apagou o estado do App.
export function resolveStoredAccent() {
  try {
    const sessionRaw = localStorage.getItem(AUTH_SESSION_KEY);
    const userId = sessionRaw ? JSON.parse(sessionRaw)?.user?.id : null;
    if (!userId) return null;

    const dataRaw = localStorage.getItem(`constancia_user_data_${userId}`);
    const profile = dataRaw ? JSON.parse(dataRaw)?.profile : null;
    if (!profile?.accentTheme) return null;

    const hasCustomColor = /^#[0-9a-fA-F]{6}$/.test(profile.customAccentColor || "");
    if (profile.accentTheme === "custom" && hasCustomColor) {
      const brass = profile.customAccentColor;
      return { brass, dim: `color-mix(in srgb, ${brass} 60%, black)`, ink: accentInkColor(brass) };
    }

    const preset = ACCENT_PRESETS[profile.accentTheme];
    if (!preset) return null;
    return { brass: preset.brass, dim: preset.dim, ink: accentInkColor(preset.brass) };
  } catch (_) {
    return null;
  }
}
