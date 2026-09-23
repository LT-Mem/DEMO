# LT-Mem Demo

Interactive LT-Mem 3D Gaussian-splat demo.

Public demo: https://lt-mem.github.io/DEMO/

The public page uses deterministic, evidence-linked questions and does not contain Google credentials.

For the poster-session Live Gemini panel, run:

```bash
python3 tools/serve_live_demo.py
```

Enter the path to a complete Google service-account JSON file, then open `http://127.0.0.1:8080`. The server listens only on this computer, reads the credentials locally, and enables the Live QA panel only on the local page. The service account needs permission to call Vertex AI in its project, and the Vertex AI API must be enabled.

On the poster MacBook, place the credential at `~/Downloads/aprl-general-key.json`, then double-click `start_live_demo.command`. It starts the local-only server and opens the demo automatically. Keep its terminal window open while presenting.
