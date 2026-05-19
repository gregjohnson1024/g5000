# Deploy runner — GitHub Actions self-hosted on Pi

The Pi (`sula-bassana`) runs the GitHub Actions runner as a systemd service. On push-to-main, GitHub queues a job; the runner picks it up over outbound HTTPS and executes `.github/workflows/deploy-pi.yml` locally — `git pull`, rebuild, `systemctl restart g5000-autopilot`.

No inbound connection to the Pi is needed. This is the equivalent of the old Forgejo Actions setup; the Pi is firewalled to outbound-only by Tailscale + the home router, so polling-out is the only practical option.

## One-time install on the Pi

### 1. Generate a registration token

In the GitHub UI: **Settings → Actions → Runners → New self-hosted runner**. Pick **Linux / ARM64**. Copy the token shown on the page (it's good for one hour).

### 2. Install the runner

```sh
ssh greg@100.64.0.117
mkdir -p ~/actions-runner && cd ~/actions-runner

# Use whatever the current version is on the new-runner page; this
# is the URL shown by GitHub at the time of writing.
curl -o actions-runner-linux-arm64.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.328.0/actions-runner-linux-arm64-2.328.0.tar.gz
tar xzf actions-runner-linux-arm64.tar.gz

# Configure with the registration token from step 1.
# Labels are how the workflow targets THIS runner — keep `sula-pi`
# matching `runs-on: [self-hosted, sula-pi]` in deploy-pi.yml.
./config.sh --url https://github.com/gregjohnson1024/g5000 \
            --token <TOKEN_FROM_STEP_1> \
            --name sula-pi \
            --labels sula-pi \
            --work _work \
            --unattended
```

### 3. Install as systemd service

```sh
cd ~/actions-runner
sudo ./svc.sh install greg
sudo ./svc.sh start
sudo ./svc.sh status   # should show "active (running)"
```

The runner now starts on boot, restarts on crash, and logs to `~/actions-runner/_diag/`.

### 4. Grant systemctl restart without sudo password

The deploy step does `sudo systemctl restart g5000-autopilot`. The runner user (`greg`) needs to be able to run that specific command without a password prompt. Add a sudoers drop-in:

```sh
sudo tee /etc/sudoers.d/g5000-deploy-runner >/dev/null <<'EOF'
greg ALL=(root) NOPASSWD: /bin/systemctl restart g5000-autopilot, /bin/journalctl -u g5000-autopilot --since *
EOF
sudo chmod 0440 /etc/sudoers.d/g5000-deploy-runner
sudo visudo -c   # syntax-check
```

The narrow allowlist keeps the runner from being able to escalate to anything else if compromised.

### 5. Verify

Push a trivial commit to main (e.g., a CLAUDE.md tweak) and watch:

- GitHub UI: **Actions** tab shows the workflow running on `sula-pi`.
- Pi: `sudo journalctl -u actions.runner.gregjohnson1024-g5000.sula-pi -f` shows job execution.
- After the job: `https://g5000.sulabassana.net/` serves the new build.

## Day-to-day

Nothing — every push to main auto-deploys. The workflow shows up in the **Actions** tab of the repo with a green/red check next to the commit. Failures email the repo owner (default GitHub behavior; configurable per-account).

## Tearing down

```sh
ssh greg@100.64.0.117
cd ~/actions-runner
sudo ./svc.sh stop
sudo ./svc.sh uninstall
./config.sh remove --token <REMOVAL_TOKEN_FROM_GITHUB_UI>
rm -rf ~/actions-runner
sudo rm /etc/sudoers.d/g5000-deploy-runner
```

GitHub UI: **Settings → Actions → Runners** → click the runner → **Remove runner** (or get a removal token there if `config.sh remove` complains).

## Notes / gotchas

- **Build cache lives in the autopilot checkout**, not the runner workspace. The workflow `cd`s into `/home/greg/autopilot` (the systemd service's working dir) for every step. `npx tsc -b` is incremental there, so a typical deploy is < 60 seconds.
- **Concurrency = 1.** `concurrency: deploy-pi` in the workflow serialises deploys; a rapid burst of push-to-main runs them one after another. We don't cancel mid-flight because a half-built `.next/` is worse than a slow queue.
- **Stale dist troubles.** Same as the manual flow — if a rebase or branch swap leaves `packages/<name>/dist/` stale and `tsc -b` skips the rebuild, the deploy will fail with "X is not exported from @g5000/Y". CLAUDE.md §Deployment documents the nuke-and-rebuild recipe: `rm -rf packages/<name>/dist && npx tsc -b packages/<name> --force`. If this becomes a routine pain, add a `--force` step to the workflow.
- **Pi reboot.** When the Pi reboots, both the runner service (`actions.runner.*`) and the g5000 autopilot service start automatically. The runner picks up any jobs queued while offline.
- **Runner version updates.** GitHub auto-updates the runner binary in place; no manual action needed unless the major version changes.
