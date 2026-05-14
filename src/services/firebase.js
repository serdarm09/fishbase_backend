const admin = require('firebase-admin');
const config = require('../config');

let firestoreInstance = null;

function getFirestore() {
  if (firestoreInstance) {
    return firestoreInstance;
  }

  if (!config.firebase.projectId || !config.firebase.clientEmail || !config.firebase.privateKey) {
    throw new Error('Firebase credentials are missing. Please set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.');
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: config.firebase.projectId,
        clientEmail: config.firebase.clientEmail,
        privateKey: config.firebase.privateKey,
      }),
    });
  }

  firestoreInstance = admin.firestore();
  return firestoreInstance;
}

module.exports = {
  getFirestore,
};
