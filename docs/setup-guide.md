# Setup guide

Playlist Repair connects to Spotify through an app that you create in your own Spotify developer
account. This takes about five minutes and is done once. The app only reads and edits your own
playlists, and only after you approve each change.

You need **Spotify Premium**: Spotify requires it for the owner of a development-mode app.

## Steps

1. Open the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and choose **Create app**.
2. Fill in **App name** and **App description** with anything you like. The name must not contain "Spotify".
3. Under **Redirect URIs**, enter `http://127.0.0.1:5173/`, exactly as written, including the final slash.
4. Choose **Web API** as the API the app will use, tick **I understand and agree with Spotify's Developer Terms of Service and Design Guidelines**, and save.
5. Under **Basic Information** on the app's page, copy the **Client ID** and paste it into the **Client ID** field. The page opens there when you create the app, and you can find it again by selecting the app on the dashboard.
6. Choose **Save client ID**, then **Log in with Spotify**.

Do not copy the client secret, and do not open **View client secret**. Playlist Repair never needs it and never asks for it.

The redirect URI must be `127.0.0.1`, not `localhost`: Spotify only accepts the loopback IP for a
local address. Open Playlist Repair at <http://127.0.0.1:5173/> too.

## If login fails

- **"INVALID_CLIENT: Invalid client"** means the client ID is wrong. Go back, choose **Use a
  different client ID** and paste it again.
- **"INVALID_CLIENT: Invalid redirect URI"** means the app in your dashboard does not list
  `http://127.0.0.1:5173/` exactly. Check for a missing final slash or a `localhost` address.

## Disconnecting

Choose **Log out** in Playlist Repair. That removes your client ID and login from the browser. To
revoke access as well, remove the app under [Manage apps](https://www.spotify.com/account/apps/)
in your Spotify account.
