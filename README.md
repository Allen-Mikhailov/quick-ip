# Quick Ip

A tiny app for tracking the IP addresses of your Raspberry Pis, so you can
SSH in without scanning your router's client list every time.

- **Web dashboard** (`public/`): sign in with Google, see every Pi's name,
  IP, Wi-Fi network, and last check-in time. Share a Pi with other Google
  accounts. Hosted on Firebase.
- **Pi service** (`pi-service/`): a small Python script + systemd service that
  runs on each Pi and reports its IP and Wi-Fi name every minute.

No Cloud Functions, no servers to run yourself — the Pi talks straight to
Firestore. Security is enforced by Firestore rules: only the Google
accounts you've added as owners control a device, and each Pi can only
update its *own* ip/wifi/lastSeen fields because it holds a per-device
secret token (it can't read or touch anyone else's data, including the
other fields on its own document).

## 1. Create the Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) and
   create a new project (Google Analytics is optional, skip it).
2. **Authentication** → Get started → enable the **Google** sign-in provider.
3. **Firestore Database** → Create database → start in production mode,
   pick any region.
4. **Project settings** (gear icon) → General → scroll to "Your apps" →
   click the web icon (`</>`) → register an app (hosting checkbox doesn't
   matter) → copy the `firebaseConfig` object it shows you.

## 2. Configure the web app

Paste the config you just copied into `public/firebase-config.js`,
replacing the placeholder values.

## 3. Deploy

```bash
npm install -g firebase-tools   # if you don't have it already
firebase login
cd quick-ip
firebase init    # choose "use an existing project", select the one you made
                  # (this will ask about hosting/firestore — firebase.json
                  # and firestore.rules are already provided, so it's safe
                  # to keep them when prompted, or just overwrite)
firebase deploy
```

Firebase will print a hosting URL like `https://your-project.web.app`.
Open it and sign in with Google.

If you'd rather test locally first: `firebase serve` and open
`http://localhost:5000` — Google sign-in works fine on localhost.

## 4. Add a device

In the dashboard, click **Add device**, give it a name. You'll immediately
see a config block — that's everything the Pi needs. Click **Copy**.

## 5. Set up the Raspberry Pi

Copy the `pi-agent/` folder onto the Pi (scp, git clone, USB stick,
whatever's easiest), then on the Pi:

```bash
cd pi-agent
nano config.json          # paste in the config you copied from the dashboard
sudo ./install_service.sh
```

That's it. The script reports the Pi's IP immediately, then every 60
seconds after that, and `install_service.sh` sets it up as a systemd
service that survives reboots.

Useful commands on the Pi:

```bash
systemctl status quick-ip-agent     # is it running?
journalctl -u quick-ip-agent -f     # watch the logs live
```

## 6. Use it

Back in the dashboard, the device's card shows its current IP, Wi-Fi
network name (if it's on Wi-Fi), and when it last checked in. Click
**Copy SSH command** to grab `ssh pi@<ip>` straight to your clipboard.
Remove a Pi any time with **Delete**.

## Sharing a device with someone else

Click **Share** on a device card and enter the other person's Google
account email. If they've already signed in to the app before, they
get owner access immediately. If not, the invite sits on the device
until they sign in for the first time — the app checks for pending
invites automatically.

Anyone with owner access can rename, share, view the pairing config, or
delete the device — there's no view-only role, so only share with people
you'd trust with full control. **Delete removes the device for every
owner**, not just you.

## How the security works (for your own peace of mind)

- `devices/{id}` documents have an `ownerUids` array, an `ownerEmails`
  array (for display only), a `pendingInviteEmails` array, a `name`, an
  `ip`, a `wifi`, a `lastSeen`, and a `token`.
- Anyone whose uid is in `ownerUids` has full control of that device —
  read, rename, share, delete. Nothing else.
- The Pi never signs in. Instead, `firestore.rules` lets an anonymous
  caller update *only* the `ip`, `wifi`, and `lastSeen` fields, and only
  if it also sends back the matching `token` — which only your Pi has,
  because you put it in `config.json`. It can't rename the device,
  change the owners, or touch any other device's data.
- When you share a device, the invited email goes into
  `pendingInviteEmails`. The rules let a signed-in user add *only
  themselves* to `ownerUids` if their email is on that list — they can't
  grant ownership to anyone else, and can't touch any other field while
  doing it.
- The `token` in `config.json` on the Pi is the device's whole secret —
  treat that file like a password (the installer sets its permissions to
  600, owner-read-only, for this reason).

## Note on Wi-Fi names

The Pi agent uses `iwgetid -r` to read the current Wi-Fi network name,
which comes preinstalled on Raspberry Pi OS. If the Pi is on ethernet or
`iwgetid` isn't available, the `wifi` field is just left blank — that's
expected, not an error.