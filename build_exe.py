"""Build standalone executable with PyInstaller."""
import PyInstaller.__main__
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))

PyInstaller.__main__.run([
    os.path.join(here, "web", "cli.py"),
    "--name=tetsuocode",
    "--onefile",
    "--console",
    f"--add-data={os.path.join(here, 'web', 'templates')}{os.pathsep}web/templates",
    f"--add-data={os.path.join(here, 'web', 'static')}{os.pathsep}web/static",
    "--hidden-import=web.app",
    "--hidden-import=flask",
    "--hidden-import=requests",
    "--hidden-import=jinja2",
    "--hidden-import=markupsafe",
    f"--distpath={os.path.join(here, 'dist')}",
    f"--workpath={os.path.join(here, 'build')}",
    f"--specpath={os.path.join(here, 'build')}",
    "--clean",
    "--noconfirm",
])

print(f"\nBuild complete! Executable is in {os.path.join(here, 'dist')}")
