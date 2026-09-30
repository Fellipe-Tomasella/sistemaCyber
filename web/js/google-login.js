/* ============================================================
   Login com Google (Firebase) — módulo.
   Anexa o fluxo a qualquer botão com [data-google-btn].
   A config abaixo é PÚBLICA (pode versionar).
   ============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDXGSRr22zA9OE225zJooSncNodbSJhzfw",
  authDomain: "cyber-atletica.firebaseapp.com",
  projectId: "cyber-atletica",
  storageBucket: "cyber-atletica.firebasestorage.app",
  messagingSenderId: "7081678563",
  appId: "1:7081678563:web:ab0b4c338306dc041f17d6",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.useDeviceLanguage();
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const qs = new URLSearchParams(location.search);
const slug = qs.get("slug") || (window.AH && AH.session && AH.session.slug) || "cyber";
const next = qs.get("next") || "/socio/home";

function mapErr(e) {
  const c = (e && e.code) || "";
  if (c === "auth/popup-blocked") return "O navegador bloqueou o popup. Libere e tente de novo.";
  if (c === "auth/network-request-failed") return "Sem conexão. Tente de novo.";
  if (c === "auth/unauthorized-domain") return "Este domínio não está autorizado no Firebase.";
  return (e && e.message) || "Não foi possível entrar com o Google";
}

async function run(btn) {
  if (!window.AH || !AH.loginWithGoogle) return;
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "Conectando…";
  try {
    const cred = await signInWithPopup(auth, provider);
    const idToken = await cred.user.getIdToken();
    await AH.loginWithGoogle(idToken, slug);
    const acc = AH.session.account;
    location.href = acc && acc.isSuperAdmin && next === "/socio/home" ? "/gestao" : next;
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = label;
    const c = (e && e.code) || "";
    if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return; // usuário fechou
    if (window.AH && AH.toast) AH.toast(mapErr(e), "err");
    console.error("[google-login]", e);
  }
}

document.querySelectorAll("[data-google-btn]").forEach((b) => b.addEventListener("click", () => run(b)));
