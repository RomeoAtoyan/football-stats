# PitchTrack AI Cloud GPU Workflow Cheat Sheet

This document lists the exact steps and terminal commands required to stop your Vast.ai RTX 4090 container to save money, resume work in the future, and sync any new local code changes to the cloud.

---

## 🛑 How to Stop Everything (To Save Money)

When you are done using the application, follow these steps to stop all billing for the RTX 4090 GPU:

### 1. Stop the FastAPI Backend (Cloud Terminal)
In your SSH terminal tab running `uvicorn`, stop the server:
* Press **`Ctrl + C`**
* Type **`exit`** and hit **Enter** to close the SSH connection.

### 2. Stop the React Frontend (Mac Terminal)
In your local Mac terminal tab running `npm run dev`, stop the Vite server:
* Press **`Ctrl + C`**

### 3. Pause the Vast.ai GPU Container (Vast.ai Dashboard)
* Go to the [Vast.ai Instances Console](https://vast.ai/console/instances/).
* Locate your active RTX 4090 instance.
* Click the **Stop (Pause)** button (the square folder/stop icon).
* *Status will change to `paused`. Your GPU billing stops instantly. You will only pay a tiny storage fee (~$0.02 - $0.05/day) to keep your files intact.*

---

## 🚀 How to Start Back Up (Resume Work)

When you want to run PitchTrack AI again, follow these steps to start your environment back up:

### 1. Start the Vast.ai Container (Vast.ai Dashboard)
* Go to the [Vast.ai Instances Console](https://vast.ai/console/instances/).
* Click the **Start (Play)** button on your container.
* Wait about **1 minute** until the status changes back to `Status: success` and shows the blue `Open` button.

### 2. Open your Mac Terminal & Connect via SSH (with Port Forwarding)
Run this command on your Mac terminal to tunnel the FastAPI port `8000` to your local machine:
```bash
ssh -p 45154 root@141.0.85.212 -L 8000:127.0.0.1:8000
```

### 3. Start the FastAPI Backend (SSH Cloud Terminal)
Inside the SSH session, navigate to the backend folder and start the API:
```bash
cd /workspace/football-stats/backend
export HF_TOKEN="your_huggingface_token_here"
uvicorn main:app --host 127.0.0.1 --port 8000
```

### 4. Start the React Frontend (Local Mac Terminal)
Open a **new terminal tab on your Mac** and run the frontend:
```bash
cd /Users/thereza/Desktop/football-stats/frontend
npm run dev
```

### 5. Open your Browser
* Go to: 👉 **`http://localhost:5173`**
* Your frontend will seamlessly communicate with the cloud RTX 4090!

---

## 🔄 How to Sync Local Code Changes to the Cloud

If you make edits to your code locally on your Mac and want to test them on the remote GPU, run this command in your **local Mac terminal** (not in the SSH tab) to instantly sync your changes:

```bash
rsync -avz -e "ssh -p 45154" --exclude="node_modules" --exclude=".git" --exclude="venv" --exclude="*cache.pkl" --exclude="uploads" /Users/thereza/Desktop/football-stats root@141.0.85.212:/workspace/
```
*This command runs in about **1 to 2 seconds** because it only uploads new or modified files while skipping all heavy assets.*
