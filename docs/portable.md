# Dumpling Booth portable package

1. Unpack this folder into a writable location.
2. Edit `config.env`. The default uses local scripted rehearsal; add your own Agora credentials and set `AGORA_ENABLED=true` for live voice.
3. Double-click `Start.command` on macOS or `Start.cmd` on Windows. Keep the terminal open.
4. On the staff page, open the guest screen in another window in the same browser profile. Move it to your TV or second display.
5. For rehearsal, choose Test without audio on the guest screen. For live voice, choose input/output devices, record and replay a short test, and confirm you heard it.

Node and SQLite are included. Live voice still needs an internet connection. Local data is written to `data/`; this package contains no real credentials or existing inventory. Keep the folder and its data between event days. Use staff backup exports before upgrades.

To restore a full JSON backup, stop the application and run the included runtime against `restore.mjs`, with the backup path and a new destination directory. Point `DATA_DIR` in `config.env` to that directory before restarting. Existing databases are never overwritten.

Project license: Apache License 2.0. LICENSE, NOTICE, and third-party notices are included.

Full guide: https://github.com/shczhen/recipe-dumpling-booth/blob/main/docs/deployment.md
