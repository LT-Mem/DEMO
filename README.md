# LT-Mem Demo

Interactive LT-Mem 3D Gaussian-splat demo.

Public demo: https://lt-mem.github.io/DEMO/

The public page uses deterministic, evidence-linked questions and does not contain a Gemini API key.

For the poster-session Live Gemini panel, run:

```bash
python3 tools/serve_live_demo.py
```

Enter the API key at the hidden terminal prompt, then open `http://127.0.0.1:8080`. The server listens only on this computer, keeps the key in memory, and enables the Live QA panel only on the local page.
