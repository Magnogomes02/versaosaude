import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const OWNER_EMAIL = "magno.gomes.santiago@gmail.com";

function parseArgs() {
  const args = {};
  for (const item of process.argv.slice(2)) {
    const [key, ...valueParts] = item.replace(/^--/, "").split("=");
    const value = valueParts.join("=");
    if (key === "email") args.email = value;
    if (key === "uid") args.uid = value;
    if (key === "name") args.name = value;
  }
  return args;
}

function initAdmin() {
  if (getApps().length) return;
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    initializeApp({ credential: cert(JSON.parse(rawJson)) });
    return;
  }
  initializeApp();
}

async function main() {
  const args = parseArgs();
  if (!args.email && !args.uid) {
    throw new Error("Informe --email=gestor@exemplo.com ou --uid=UID_DO_USUARIO.");
  }

  initAdmin();
  const auth = getAuth();
  const firestore = getFirestore();
  const user = args.uid
    ? await auth.getUser(args.uid)
    : await auth.getUserByEmail(args.email);
  const targetEmail = user.email ?? args.email ?? null;
  if (targetEmail?.toLowerCase() === OWNER_EMAIL) {
    throw new Error(`Use npm run bootstrap:owner para ${OWNER_EMAIL}.`);
  }

  await firestore.doc(`profiles/${user.uid}`).set({
    email: targetEmail,
    fullName: args.name ?? user.displayName ?? user.email ?? "Gestor",
    updatedAt: new Date(),
  }, { merge: true });

  await firestore.doc(`user_roles/${user.uid}`).set({
    role: "gestor",
    email: targetEmail,
    updatedAt: new Date(),
  }, { merge: true });

  console.log(`Gestor configurado: ${user.uid} (${user.email ?? "sem email"})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
