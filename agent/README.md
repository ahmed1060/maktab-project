# Nizmo attendance agent

The Local Sync Agent runs on a Windows PC in the office. It reads the ZKTeco
and Hikvision fingerprint terminals on the office network, and sends their
scans to Nizmo over HTTPS. Nothing reaches the terminals from the internet:
the agent only connects out. It reads Hikvision terminals from version 0.3.0.
From version 0.4.0 it also takes the scans of a ZKTeco terminal that pushes
them to the agent's PC over the office network. See
[A terminal that pushes to the agent](#a-terminal-that-pushes-to-the-agent).

## What you need

- A Windows PC that stays on during working hours, on the same network as the
  terminals. Windows 10 or later, or Windows Server 2016 or later.
- Each terminal's IP address. You can find it on the terminal under
  **Menu → Comm. → Ethernet**.
- The terminal's **comm password**, if one is set (**Menu → Comm. → Comm Key**).
  It is usually 0.
- For a **Hikvision** terminal, a user made on it for the agent, on its web
  page under **User Management**, with only the rights reading its events
  needs where the model allows, rather than its admin. See
  [A Hikvision terminal](#a-hikvision-terminal).
- An administrator of your company on Nizmo, who can open
  **Company Settings → Attendance → Fingerprint terminals**.

## Install

1. Unzip the package to `C:\Program Files\Nizmo Agent`.
2. Copy `agent.example.json` to `agent.json`. Set `server` to your Nizmo address,
   and list your terminals:

   ```json
   {
     "server": "https://your-company-site.example.com",
     "devices": [
       { "host": "192.168.1.20", "name": "Front door" },
       { "host": "192.168.1.21", "name": "Back gate", "password": 1234 }
     ],
     "pollSeconds": 60
   }
   ```

3. Open **Command Prompt as administrator** in that folder. Check that each
   terminal answers:

   ```
   nizmo-agent.exe probe 192.168.1.20
   ```

   It shows the terminal's serial number, its clock, and how many scans it holds.
   It sends nothing. It doesn't read `agent.json`, so if the terminal has a comm
   password, give the port and the password after its address:

   ```
   nizmo-agent.exe probe 192.168.1.20 4370 1234
   ```

4. In Nizmo, choose **Add an agent**, and give it a name such as "Head office".
   Type the code you are shown:

   ```
   nizmo-agent.exe enrol K7QD-2MXP
   ```

   The code works once, for 30 minutes.

5. Install and start the service:

   ```
   nizmo-agent-service.exe install
   nizmo-agent-service.exe start
   ```

Within a minute the agent shows as **Connected** in Nizmo, and the terminals
appear under it. Map each employee's terminal number to the person under
**Attendance → Employee numbers**. Scans from numbers nobody is mapped to wait
there until they are mapped.

## A Hikvision terminal

A Hikvision terminal is read over its web interface (ISAPI), with the user
made on it for the agent. Its password is that user's, in quotes:

```json
{ "protocol": "hikvision", "host": "192.168.1.30", "user": "nizmo-agent", "password": "…", "name": "Lobby" }
```

- It's read over **HTTPS** on port 443. Check HTTPS is on, under
  **Network → Network Service → HTTP(S)** on many models. If it can't be
  turned on, add `"https": false`: it's then read over HTTP on port 80, on
  the office network only. `"port"` sets another port.
- Leave its **HTTP Listening** off: that's for sending straight to Nizmo, and a
  terminal connects one way at a time.
- Check it answers. `probe` asks for the user's password without showing it as
  you type, shows the terminal's serial number, model, firmware, clock and
  certificate, and sends nothing:

  ```
  nizmo-agent.exe probe hikvision 192.168.1.30 nizmo-agent
  ```

  Add `--http` for one whose HTTPS is off, and a port after the user if it
  isn't the usual one.
- **Its certificate** is its own, signed by nobody, so the agent trusts the one
  it shows the first time it reads it, and the log says which. After that, a
  terminal showing another certificate at its address is refused with
  `HIK_CERTIFICATE_CHANGED`: another machine could be answering there. If it's
  the same terminal and its certificate was renewed, as after a reset or a
  firmware update, stop the service, and run:

  ```
  nizmo-agent.exe trust 192.168.1.30
  ```

  It shows the terminal's serial number and its new certificate, and trusts
  that one from now on. Then start the service again.
- The agent never clears a Hikvision terminal's memory.

## A terminal that pushes to the agent

Some ZKTeco terminals send their scans themselves, to a server set under
**Menu → Comm. → Cloud Server Setting** (ADMS), and only over plain HTTP, and
can't be read on port 4370. Such a terminal sends its scans to the agent's PC
instead, on the office network, and the agent sends them on to Nizmo over
HTTPS with the others. Nothing it sends leaves the building any other way.

1. Give the PC a fixed address on the office network, such as a reservation
   for it on the office's router: the terminal names the PC by its address.
2. In `agent.json`, list the terminal by **its IP address**, with
   `"push": true`. It has no `"port"` or `"password"` of its own:

   ```json
   { "host": "192.168.1.40", "push": true, "name": "Side door" }
   ```

   The agent listens on port 8081. `"listenPort"` at the top of `agent.json`
   sets another, for all of them.
3. Let the terminal reach the agent through Windows Firewall, from its
   address alone, in **Command Prompt as administrator**:

   ```
   netsh advfirewall firewall add rule name="Nizmo agent" dir=in action=allow protocol=TCP localport=8081 remoteip=192.168.1.40 profile=private,domain
   ```

   For several terminals, list their addresses after `remoteip=`, separated
   by commas. The rule holds on a private or work network: if Windows calls
   the office network public, set it to private under **Settings → Network
   & internet**. Nothing is opened on the office's router.
4. On the terminal, under **Cloud Server Setting**: turn **Domain Name** off,
   set **Server Address** to the PC's address and **Server Port** to 8081,
   and leave **HTTPS** and **Proxy** off. The names differ a little by model.
5. Restart the service (`nizmo-agent-service.exe stop`, then `start`). Within
   a minute or two the log says the terminal called, and it appears in
   Nizmo under the agent.

Until the agent is enrolled, it refuses what the terminal sends, and the
terminal keeps its scans and sends them again later. Each scan is stored
once, however often it's sent. The agent never clears such a terminal's
memory, and never sends it commands.

## Day to day

- The agent starts with Windows and restarts itself if it stops.
- Scans are kept in `state.json` until Nizmo has them. If the internet is down,
  nothing is lost; they are sent when it is back.
- Only scans from the month the agent was enrolled onwards are sent. To send
  older ones, set `"sendFrom": "YYYY-MM-DD"` in `agent.json` and restart the
  service. Months whose payroll is already approved are refused.
- The log is in `logs\agent.log`.

## Clearing a terminal's memory

A terminal holds a limited number of scans, and stops recording when it is
full. Nizmo shows a warning at 80%. To let the agent clear it, set
`"clearWhenFull": true`. The agent then clears a terminal once it is 90% full
(`"clearAtRatio"` changes this), and only when every scan in it has been
delivered. It stops the terminal taking scans for the moment it takes to check
and clear, then turns it back on.

## A terminal set to connect straight to Nizmo

A terminal can be set in Nizmo to send its scans straight to Nizmo instead of
through this agent. The agent then sends what it has already read from that
terminal, stops reading its log, and never clears it. Each scan is stored
once, whichever way it arrives. Set back to the agent, the terminal is read
again from where the agent stopped. The terminal can stay in `agent.json`
meanwhile.

A terminal that pushes to the agent and is set to connect straight to Nizmo
has what it sends refused by the agent, so it keeps its scans until its
**Cloud Server Setting** names Nizmo, or it is set back to the agent.

## Updating the agent

A newer package is unzipped over the old one, with the service stopped:

1. `nizmo-agent-service.exe stop`
2. Unzip the new package over `C:\Program Files\Nizmo Agent`. `agent.json`,
   `state.json` and the log are kept, and the agent needs no new code.
3. `nizmo-agent-service.exe start`

`nizmo-agent.exe version` shows the version installed, and Nizmo shows it on
the agent's card too. A Hikvision terminal needs 0.3.0 or later, and a
terminal that pushes to the agent 0.4.0 or later.

## Moving to another PC

In Nizmo, choose **Move to another PC** on the agent. Install on the new PC with
the new code, and uninstall from the old one. The old PC stops working as soon
as the new one is enrolled.

## Something wrong

| You see | What to do |
|---|---|
| **Not heard from** in Nizmo | Is the PC on, and is the service running (`nizmo-agent-service.exe status`)? Check `logs\agent.log`. |
| **Agent can't reach it** on a terminal | Check its IP address and network cable. Run `nizmo-agent.exe probe <address>`. |
| `ZK_AUTH_FAILED` | The terminal has a comm password. Add `"password"` for it in `agent.json`. |
| `HIK_AUTH_FAILED` | The Hikvision terminal refused the agent's user or password. Check both in `agent.json` and on the terminal. |
| `HIK_CERTIFICATE_CHANGED` | The Hikvision terminal shows another certificate than before. If it's the same terminal, run `nizmo-agent.exe trust <address>` with the service stopped. See [A Hikvision terminal](#a-hikvision-terminal). |
| `HIK_UNREACHABLE` | Check the terminal's address, and that its HTTPS is on, or that `agent.json` says `"https": false`. Run `nizmo-agent.exe probe hikvision <address> <user>`. |
| `The server no longer accepts this agent` | It was revoked or moved. Get a new code in Nizmo, then `nizmo-agent-service.exe stop`, `nizmo-agent.exe enrol <code>`, `nizmo-agent-service.exe start`. |
| `… pushes to this agent and hasn't called yet` | On the terminal, check **Cloud Server Setting** names this PC's address and port 8081 (or `"listenPort"`), with HTTPS off, and that the firewall rule lets its address in. See [A terminal that pushes to the agent](#a-terminal-that-pushes-to-the-agent). |
| `Can't listen for terminals that push: Port 8081 is in use` | Another program on the PC holds the port. Set `"listenPort"` in `agent.json` to a free one, the same on the terminal and in the firewall rule, and restart the service. |
| `… called the agent, but no terminal in agent.json is at that address` | A terminal's address changed, or it isn't listed. Put its address in `agent.json`, and in the firewall rule. |
| `Another nizmo-agent … is using this folder` | The service is running. Stop it before `enrol` or `check`, and start it again after. |
| **Clock off** on a terminal | Set the terminal's date and time. Scans are recorded by its clock. |

`state.json` holds the agent's key to your company. Keep the folder readable by
administrators only, which is the default under `Program Files`.

## For developers

```
cd agent
npm ci
npm run build        # dist/nizmo-agent.cjs, runs with node
npm run build:exe    # also dist/nizmo-agent(.exe), a single executable
```

The tests run with the rest of the repository (`npx vitest run agent`), against
simulated terminals (`test/fake-zk-device.ts`, `test/fake-hik-device.ts`) and a
stand-in for the server (`test/fake-server.ts`), which checks what the agent
sends against the website's own schemas. A new version is set in
`src/version.ts`, `package.json` and `package-lock.json` together. The Windows package is built by the **Attendance
agent** workflow, run by hand from GitHub Actions. It is signed when the
`WINDOWS_CERT_PFX` and `WINDOWS_CERT_PASSWORD` secrets are set.
