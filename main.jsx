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

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
