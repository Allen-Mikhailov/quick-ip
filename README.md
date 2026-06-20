# Pi Fleet

A tiny app for tracking the IP addresses of your Raspberry Pis, so you can
SSH in without scanning your router's client list every time.

- **Web dashboard** (`public/`): sign in with Google, see every Pi's name,
  IP, and last check-in time. Hosted on Firebase.
- **Pi agent** (`pi-agent/`): a small Python script + systemd service that
  runs on each Pi and reports its IP every minute.

No Cloud Functions, no servers to run yourself — the Pi talks straight to
Firestore. Security is enforced by Firestore rules: your Google account
fully controls your devices, and each Pi can only update its *own* IP
because it holds a per-device secret token (it can't read or touch anyone
else's data, including the other fields on its own document).

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
cd pi-fleet
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
systemctl status pi-fleet-agent     # is it running?
journalctl -u pi-fleet-agent -f     # watch the logs live
```

## 6. Use it

Back in the dashboard, the device's card will show its current IP and
when it last checked in. Click **Copy SSH command** to grab `ssh pi@<ip>`
straight to your clipboard. Remove a Pi any time with **Delete**.

## How the security works (for your own peace of mind)

- `devices/{id}` documents have an `ownerUid`, a `name`, an `ip`, a
  `lastSeen`, and a `token`.
- Your Google account (matched by `ownerUid`) can read, rename, and delete
  its own devices — full control, nothing else.
- The Pi never signs in. Instead, `firestore.rules` lets an anonymous
  caller update *only* the `ip` and `lastSeen` fields, and only if it also
  sends back the matching `token` — which only your Pi has, because you
  put it in `config.json`. It can't rename the device, change the owner,
  or touch any other device's data.
- The `token` in `config.json` on the Pi is the device's whole secret —
  treat that file like a password (the installer sets its permissions to
  600, owner-read-only, for this reason).
