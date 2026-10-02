# Nizmo attendance agent

The Local Sync Agent runs on a Windows PC in the office. It reads the ZKTeco
fingerprint terminals on the office network, and sends their scans to Nizmo
over HTTPS. Nothing reaches the terminals from the internet: the agent only
connects out.

## What you need

- A Windows PC that stays on during working hours, on the same network as the
  terminals. Windows 10 or later, or Windows Server 2016 or later.
- Each terminal's IP address. You can find it on the terminal under
  **Menu → Comm. → Ethernet**.
- The terminal's **comm password**, if one is set (**Menu → Comm. → Comm Key**).
  It is usually 0.
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
   It sends nothing.

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
| `The server no longer accepts this agent` | It was revoked or moved. Get a new code in Nizmo, then `nizmo-agent-service.exe stop`, `nizmo-agent.exe enrol <code>`, `nizmo-agent-service.exe start`. |
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
a simulated terminal (`test/fake-zk-device.ts`) and a stand-in for the server
(`test/fake-server.ts`). The Windows package is built by the **Attendance
agent** workflow, run by hand from GitHub Actions. It is signed when the
`WINDOWS_CERT_PFX` and `WINDOWS_CERT_PASSWORD` secrets are set.
