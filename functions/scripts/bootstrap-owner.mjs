import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const DEFAULT_OWNER_EMAIL = "magno.gomes.santiago@gmail.com";

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
  const email = args.email ?? DEFAULT_OWNER_EMAIL;

  initAdmin();
  const auth = getAuth();
  const firestore = getFirestore();
  const user = args.uid
    ? await auth.getUser(args.uid)
    : await auth.getUserByEmail(email);

  const previousOwners = await firestore.collection("user_roles").where("role", "==", "owner").get();
  const batch = firestore.batch();
  previousOwners.docs
    .filter((doc) => doc.id !== user.uid)
    .forEach((doc) => {
      batch.set(doc.ref, {
        role: "gestor",
        previousRole: "owner",
        ownerRevokedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

  batch.set(firestore.doc(`profiles/${user.uid}`), {
    email: user.email ?? email,
    fullName: args.name ?? user.displayName ?? user.email ?? "Owner",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  batch.set(firestore.doc(`user_roles/${user.uid}`), {
    role: "owner",
    email: user.email ?? email,
    unique: true,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await batch.commit();
  await auth.setCustomUserClaims(user.uid, { role: "owner", owner: true, gestor: true });

  console.log(`Owner configurado: ${user.uid} (${user.email ?? email})`);
  console.log(`Owners anteriores rebaixados para gestor: ${previousOwners.docs.filter((doc) => doc.id !== user.uid).length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
