// Get these values from: Firebase Console → Project settings → General → Your apps → Web app
// This is the public web config, not a secret — it's safe to ship in client code.
// Security is enforced by firestore.rules, not by hiding this object.

window.firebaseConfig = {
  apiKey: "PASTE_API_KEY_HERE",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};
