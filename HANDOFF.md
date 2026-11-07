# Handoff

Current state, and how to pick the project up on a new machine. `CLAUDE.md` explains how the code works. Keep this file up to date: delete what's done.

## Pending owner tests

**Agents: remind the owner of this list at the start of each session until they clear it, and delete items as they confirm them.**

Everything below shipped in v2.3.0 without the owner trying it yet. An agent tested the items marked (a) in a browser; the rest were checked by reading the code or not at all.

Start with `npm run tiles` (once), then `npm run dev`, then open <http://localhost:5173/admin>.

**Editor**

- [ ] (a) **Speeds:** select a point, type a km/h, then click straight on the next point without pressing Tab. The number stays on the first point.
- [ ] (a) **Braking zones:** zoom all the way out on Tremblant, press B, click near the line twice. A zone appears.
- [ ] (a) **Swap an icon:** select a marker, change Icon in the panel.
- [ ] **Swap an imported icon:** open Tremblant, select an imported marker, change Icon. The new icon has a sensible size, and Ctrl+Z brings the old art back.
- [ ] (a) **Shortcuts:** click a line's radio button, then press B. Press M to open the palette.
- [ ] (a) **Off-photo clicks:** with the marker tool, click the black area. Nothing is placed.
- [ ] **Passing zone arrows:** select a zone, click Add arrow twice. The arrows spread out evenly.
- [ ] **New icons:** place the 13 new ones (turn-in point, bridge, building, tire wall, wall, stay off, blind spot, bumps, pavement seam, gravel trap, off-camber, uphill, downhill) and check they read well at the zoom students use.
- [ ] (a) **Whole new track:** photo, line, lap length, speeds, Save. It opens at `/<slug>`, and the replay drives it.

**Viewer**

- [ ] **French fallback:** make a track with `Nom` empty, switch to FR. The English name shows.
- [ ] (a) **Track chooser:** with 2+ listed tracks, open `/` in a private window. Pick a track, reopen `/`: the same track opens. Switch tracks from the menu.
- [ ] (a) **Link only:** tick it in the editor and Save. In a private window the track isn't in the lists, but `/<slug>` opens it.
- [ ] **Replay and camera, on a phone:** Follow and Fixed modes, pan and zoom while it plays, Auto-rotate, and leaving the replay restores the view. First release of this rework.
- [ ] **Share:** the QR code and link from `/<slug>` open the same track and view.
- [ ] **Old links:** an old `/?s=...` link opens Tremblant.

**Deployed site**

- [ ] **Update:** pull v2.3.0 in Portainer. An already-installed phone app picks up the new version.
- [ ] (a) **`/admin` on the site:** it opens, and Save downloads a zip.
- [ ] **Zip drafts:** make a new track there, Save, keep editing, close the tab, reopen `/admin`. The draft is listed with your last edits.
- [ ] **Offline:** in the installed app, open a track, go offline, reopen it.

**Publishing**

- [ ] `npm run publish-tracks -- --dry-run` on `main` reports what it would do. It was rehearsed against a throwaway repo; v2.3.0 itself was tagged by hand.

## Set up a machine

1. Install git, Node 20 or newer (the image builds on 20) and the libvips command line (Debian/Ubuntu: `sudo apt install libvips-tools`; `vips dzsave --help` must work). Docker is optional, for building the image locally.
2. Clone and build:

   ```bash
   git clone https://github.com/APatenaude/TrackMapViewer.git
   cd TrackMapViewer
   npm ci
   npm run tiles
   npm run build
   ```

3. Set `git config user.name` and `user.email`, and sign in with an account that can push (`gh auth login`, or an SSH key). `git push --dry-run` must succeed.
4. For UI checks, add a browser: `claude mcp add playwright -- npx @playwright/mcp@latest`.
5. Copy `compose.traefik.yml` to the repo root if this machine deploys. It's the private Portainer/Traefik stack and is gitignored, so it never reaches GitHub. Never commit it.

Tiles (`public/tracks/`), `node_modules/` and `dist/` are generated, so there's nothing to copy for them.

**Saving from another computer:** the editor's Save writes to the repo only for requests from the server's own machine with a `localhost` address. Opening `http://<server>:5173/admin` from your PC therefore downloads a zip instead. To save directly, tunnel the port (`ssh -L 5173:localhost:5173 <server>`) and open <http://localhost:5173/admin>.

## Commit and deploy

1. Verify with `npm run build`, plus a browser check for anything visible.
2. Commit, and get the work onto `main`.
3. Release:
   - **Tracks:** `npm run publish-tracks` from `main` checks the build, commits `tracks/`, tags the next patch version and pushes. Commit any other changes first; it only commits `tracks/`.
   - **Bigger feature:** tag by hand, for example `git tag v2.4.0 && git push origin v2.4.0`.
4. The tag runs `.github/workflows/release.yml`, which publishes `ghcr.io/apatenaude/track-map` as `:X.Y.Z`, `:X.Y` and `:latest`.
5. Deployment isn't automatic: pull and redeploy the stack in Portainer. An agent can only do this if the owner gives it a way in.

## Product decisions

- **Audience:** an HPDE instructor sharing tracks with students. The owner is the only editor.
- **Never show speed to students:** no km/h, no lap time and no speed-colored line in the viewer. Speeds are authoring data; being readable in the public `track.json` is accepted.
- **No accounts, no backend, no auth.** Tracks live in the repo and arrive with a deployment. `/admin` is open everywhere because a static site can't be written to; only a git push publishes.
- **No default track:** visitors choose once, and it's remembered. Link only hides a track from the lists, but isn't private.
- **Manual on purpose:** deleting a track, replacing a photo and changing a web address are file edits (see README). No GUI for those.
- **Editor scope:** computer-first, touch only for small fixes. Braking zones are drawn by hand, not derived from speeds.
- **Camera:** in Follow, panning and zooming set the framing that rides with the car, and never pause playback. In Fixed, the car drives through a still view. Leaving the replay restores the view.
- **A later option, not chosen:** a Publish button on the deployed `/admin` that commits through a GitHub token kept in the owner's browser, if publishing away from a dev machine is ever wanted.

## Next work

- Tremblant: replace the placeholder speeds (needs the owner's numbers) and swap imported markers for built-in icons.
- Add more tracks.
- Smaller ideas: group the long icon palette into sections, hide layers in the editor when markers are dense, add a test suite (there is none), and bring `package.json`'s version in line with the tags.

## Working with the owner

- Keep replies short, conclusion first. Answer status questions directly from this file, git and a few reads.
- Do the work in the main session. Don't launch agent fleets or workflows unasked, even if a session setting encourages them: the owner has been burned by a costly run that produced nothing. If a review helps, use one narrow, cheap agent.
- The owner's general rules (commit only when told, no writes to databases, and so on) live in their personal `~/.claude/CLAUDE.md`, not in this repo.
