"""tetsuocode CLI — launch the AI coding assistant."""
import argparse
import os
import sys
import webbrowser
import threading


def main():
    parser = argparse.ArgumentParser(
        prog="tetsuocode",
        description="AI coding assistant powered by Grok",
    )
    parser.add_argument("workspace", nargs="?", default=os.getcwd(),
                        help="Workspace directory (default: current directory)")
    parser.add_argument("-p", "--port", type=int, default=5000,
                        help="Port to run on (default: 5000)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="Host to bind to (default: 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true",
                        help="Don't auto-open browser")
    parser.add_argument("--password", default="",
                        help="Set access password")
    parser.add_argument("--api-key", default="",
                        help="xAI API key (or set XAI_API_KEY env var)")
    parser.add_argument("--version", action="version", version="tetsuocode 1.0.0")

    args = parser.parse_args()

    # Set environment
    workspace = os.path.abspath(args.workspace)
    if not os.path.isdir(workspace):
        print(f"Error: {workspace} is not a directory")
        sys.exit(1)

    os.environ["TETSUO_WORKSPACE"] = workspace
    if args.password:
        os.environ["TETSUO_PASSWORD"] = args.password
    if args.api_key:
        os.environ["XAI_API_KEY"] = args.api_key

    # Load .tetsuorc config if present
    rc_path = os.path.join(workspace, ".tetsuorc")
    if os.path.exists(rc_path):
        try:
            import json
            with open(rc_path) as f:
                config = json.load(f)
            if config.get("api_key"):
                os.environ.setdefault("XAI_API_KEY", config["api_key"])
            if config.get("password"):
                os.environ.setdefault("TETSUO_PASSWORD", config["password"])
            print(f"Loaded config from {rc_path}")
        except Exception as e:
            print(f"Warning: Failed to load .tetsuorc: {e}")

    # Import app after env is set
    from web.app import app

    url = f"http://{args.host}:{args.port}"
    print(f"\n  tetsuocode v1.0.0")
    print(f"  Workspace: {workspace}")
    print(f"  Running on {url}")
    print(f"  Press Ctrl+C to quit\n")

    # Auto-open browser
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()

    try:
        app.run(host=args.host, port=args.port, debug=False, use_reloader=False)
    except KeyboardInterrupt:
        print("\nShutting down...")


if __name__ == "__main__":
    main()
