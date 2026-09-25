import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import "./src/styles/app.css";

// Registrado aqui (fora do fluxo de login/notificações push em App.jsx) pra
// cachear o shell do app desde a primeira visita, mesmo antes de logar. Antes
// o único registro ficava dentro do fluxo de permissão de push — em
// navegadores sem PushManager (ex.: iOS fora do modo instalado) o service
// worker nunca chegava a existir, e sem ele a abertura do app nunca se
// beneficiava do cache. register() é idempotente, então isso não conflita
// com os registros que App.jsx ainda faz para configurar push.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
}

// PWA retomado (iOS/Android) não recarrega a página: uma versão publicada só
// passava a valer quando o sistema matava o app — correções "não chegavam".
// Ao voltar pra frente, compara o bundle em execução com o do index.html
// publicado e, se mudou, recarrega nesse momento (o usuário acabou de voltar,
// ainda não começou a mexer; outboxes e fila pendente ficam no localStorage).
// `__v` faz o service worker deixar essa requisição passar direto pra rede.
const runningEntry = () => document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute("src") || "";
let lastVersionCheckAt = 0;
async function reloadIfNewVersion() {
  const running = runningEntry();
  if (!running || Date.now() - lastVersionCheckAt < 60000) return;
  lastVersionCheckAt = Date.now();
  try {
    const res = await fetch(`/index.html?__v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const latest = (await res.text()).match(/<script[^>]+src="(\/assets\/index-[^"]+\.js)"/)?.[1];
    if (latest && latest !== running) window.location.reload();
  } catch (_) {
    // Sem rede: tenta de novo no próximo retorno ao app.
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") reloadIfNewVersion();
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
