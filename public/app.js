// ---- Firebase init ----
if (!window.firebaseConfig || !window.firebaseConfig.apiKey || window.firebaseConfig.apiKey.startsWith('PASTE_')) {
  const msg = 'firebase-config.js did not load, or still has placeholder values. ' +
    'Check that public/firebase-config.js exists, loads before app.js (Network tab), ' +
    'and has your real project values filled in.';
  document.body.innerHTML = `<div style="font-family:sans-serif;max-width:560px;margin:60px auto;padding:20px;border:1px solid #f3c6c6;background:#fdecec;border-radius:8px;">${msg}</div>`;
  throw new Error(msg);
}

firebase.initializeApp(window.firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const STALE_AFTER_MS = 5 * 60 * 1000; // device considered "stale" if no check-in for 5 min

// ---- DOM refs ----
const loginView = document.getElementById('loginView');
const dashboardView = document.getElementById('dashboardView');
const userbox = document.getElementById('userbox');
const userPhoto = document.getElementById('userPhoto');
const userName = document.getElementById('userName');
const deviceList = document.getElementById('deviceList');
const emptyState = document.getElementById('emptyState');

const signInBtn = document.getElementById('signInBtn');
const signOutBtn = document.getElementById('signOutBtn');
const addDeviceBtn = document.getElementById('addDeviceBtn');

const addModal = document.getElementById('addModal');
const deviceNameInput = document.getElementById('deviceNameInput');
const cancelAddBtn = document.getElementById('cancelAddBtn');
const confirmAddBtn = document.getElementById('confirmAddBtn');

const pairModal = document.getElementById('pairModal');
const pairDeviceName = document.getElementById('pairDeviceName');
const pairConfig = document.getElementById('pairConfig');
const copyConfigBtn = document.getElementById('copyConfigBtn');
const closePairBtn = document.getElementById('closePairBtn');

let unsubscribeDevices = null;
let currentUserEmail = null;

// ---- Auth ----
signInBtn.addEventListener('click', () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(err => alert('Sign-in failed: ' + err.message));
});

signOutBtn.addEventListener('click', () => auth.signOut());

auth.onAuthStateChanged(user => {
  if (user) {
    currentUserEmail = user.email || null;
    loginView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    userbox.classList.remove('hidden');
    userPhoto.src = user.photoURL || '';
    userName.textContent = user.displayName || user.email || '';
    claimPendingInvites(user);
    watchDevices(user.uid);
  } else {
    currentUserEmail = null;
    loginView.classList.remove('hidden');
    dashboardView.classList.add('hidden');
    userbox.classList.add('hidden');
    if (unsubscribeDevices) { unsubscribeDevices(); unsubscribeDevices = null; }
    deviceList.innerHTML = '';
  }
});

// If someone shared a device with this account's email before they ever
// signed in, claim it now — turns a pending invite into real ownership.
async function claimPendingInvites(user) {
  if (!user.email) return;
  try {
    const snap = await db.collection('devices')
      .where('pendingInviteEmails', 'array-contains', user.email)
      .get();
    const claims = snap.docs.map(doc => doc.ref.update({
      ownerUids: firebase.firestore.FieldValue.arrayUnion(user.uid),
      ownerEmails: firebase.firestore.FieldValue.arrayUnion(user.email),
      pendingInviteEmails: firebase.firestore.FieldValue.arrayRemove(user.email)
    }));
    await Promise.all(claims);
  } catch (err) {
    console.error('Could not claim pending invites:', err);
  }
}

// ---- Device list ----
function watchDevices(uid) {
  if (unsubscribeDevices) unsubscribeDevices();
  unsubscribeDevices = db.collection('devices')
    .where('ownerUids', 'array-contains', uid)
    .onSnapshot(snapshot => {
      const docs = snapshot.docs.sort((a, b) => a.data().name.localeCompare(b.data().name));
      renderDevices(docs);
    }, err => console.error('Device listener error:', err));
}

function renderDevices(docs) {
  deviceList.innerHTML = '';
  emptyState.classList.toggle('hidden', docs.length > 0);

  docs.forEach(doc => {
    const d = doc.data();
    const card = document.createElement('div');
    card.className = 'device-card';

    const lastSeenMs = d.lastSeen ? d.lastSeen.toMillis() : null;
    const now = Date.now();
    let dotClass = 'dot';
    let statusText = 'Never checked in';
    if (lastSeenMs) {
      const age = now - lastSeenMs;
      if (age < STALE_AFTER_MS) { dotClass += ' online'; statusText = 'Online · seen ' + relativeTime(age); }
      else { dotClass += ' stale'; statusText = 'Last seen ' + relativeTime(age); }
    }

    const owners = d.ownerEmails || [];
    const invites = d.pendingInviteEmails || [];
    const sharedBits = [];
    if (owners.length > 1) sharedBits.push(`Shared with ${owners.filter(e => e !== currentUserEmail).join(', ')}`);
    if (invites.length) sharedBits.push(`Invited: ${invites.join(', ')}`);
    const sharedRow = sharedBits.length
      ? `<div class="status-row muted">${sharedBits.map(escapeHtml).join(' · ')}</div>`
      : '';

    card.innerHTML = `
      <div class="name">${escapeHtml(d.name)}</div>
      <div class="${d.ip ? 'ip' : 'ip unknown'}">${d.ip ? escapeHtml(d.ip) : 'No address yet'}</div>
      ${d.wifi ? `<div class="wifi">📶 ${escapeHtml(d.wifi)}</div>` : ''}
      <div class="status-row"><span class="${dotClass}"></span>${statusText}</div>
      ${sharedRow}
      <div class="card-actions">
        <button class="btn ghost small" data-action="ssh">Copy SSH command</button>
        <button class="btn ghost small" data-action="share">Share</button>
        <button class="btn ghost small" data-action="pair">View config</button>
        <button class="btn danger small" data-action="delete">Delete</button>
      </div>
    `;

    card.querySelector('[data-action="ssh"]').addEventListener('click', () => {
      if (!d.ip) { alert('This device has not reported an address yet.'); return; }
      copyToClipboard(`ssh pi@${d.ip}`);
    });

    card.querySelector('[data-action="share"]').addEventListener('click', () => {
      const email = prompt(`Share "${d.name}" with someone's Google account email:`);
      if (!email) return;
      const cleaned = email.trim().toLowerCase();
      if (!cleaned.includes('@')) { alert('That doesn\'t look like an email address.'); return; }
      db.collection('devices').doc(doc.id).update({
        pendingInviteEmails: firebase.firestore.FieldValue.arrayUnion(cleaned)
      });
    });

    card.querySelector('[data-action="pair"]').addEventListener('click', () => {
      showPairModal(doc.id, d);
    });

    card.querySelector('[data-action="delete"]').addEventListener('click', () => {
      const warning = owners.length > 1
        ? `Remove "${d.name}"? This will remove it for all ${owners.length} owners, not just you.`
        : `Remove "${d.name}"? This Pi will stop being tracked.`;
      if (confirm(warning)) {
        db.collection('devices').doc(doc.id).delete();
      }
    });

    deviceList.appendChild(card);
  });
}

function relativeTime(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {}, () => alert('Could not copy automatically — copy manually: ' + text));
}

// ---- Add device ----
addDeviceBtn.addEventListener('click', () => {
  deviceNameInput.value = '';
  addModal.classList.remove('hidden');
  deviceNameInput.focus();
});

cancelAddBtn.addEventListener('click', () => addModal.classList.add('hidden'));

confirmAddBtn.addEventListener('click', async () => {
  const name = deviceNameInput.value.trim();
  if (!name) { alert('Give the device a name.'); return; }

  const user = auth.currentUser;
  const token = generateToken();
  const docRef = db.collection('devices').doc();

  await docRef.set({
    ownerUids: [user.uid],
    ownerEmails: [user.email || ''],
    pendingInviteEmails: [],
    name,
    ip: '',
    wifi: '',
    token,
    lastSeen: null
  });

  addModal.classList.add('hidden');
  showPairModal(docRef.id, { name, token });
});

function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// ---- Pair modal ----
function showPairModal(deviceId, d) {
  pairDeviceName.textContent = d.name;
  const config = {
    project_id: window.firebaseConfig.projectId,
    api_key: window.firebaseConfig.apiKey,
    device_id: deviceId,
    token: d.token,
    name: d.name,
    interval_seconds: 60
  };
  pairConfig.textContent = JSON.stringify(config, null, 2);
  pairModal.classList.remove('hidden');
}

copyConfigBtn.addEventListener('click', () => copyToClipboard(pairConfig.textContent));
closePairBtn.addEventListener('click', () => pairModal.classList.add('hidden'));