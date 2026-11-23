# Curriculum Tree service

One small Node program with no dependencies. It serves the page and the course files, keeps the roster, and stores each student's attempt log on disk.

## Deploy on Render

1. Put this folder in a Git repository and create a **Web Service** from it.
2. Runtime: Node. Build command: leave empty. Start command: `node server.js`.
3. Add a **Disk** and note its mount path, for example `/var/data`.
4. Environment variables:
   - `DATA_DIR` = the disk's mount path.
   - `TEACHER_KEY` = a long phrase only you know. If you leave it out, the service makes one on first start and writes it to `teacher-key.txt` on the disk.

## Use

- **Teacher view:** open `/teach` and enter the key. Create a class, paste or upload the names (one per line, or the first column of a CSV), and copy the personal links.
- **Students:** each opens their own link once on each device. The link signs them in and is then removed from the address bar. Progress is kept on the device and sent to the service in the background.
- **Class on the tree:** in the teacher view, "Show this class on the tree" fills every card's mark with the share of the class that has mastered it, and the menu beside it switches to one student.
- **Without a link** the page still works, and progress stays on that device only.

## What is stored

| File on the disk | Contents |
|---|---|
| `roster.json` | Classes, student names, and each student's link token |
| `logs/<student>.jsonl` | One line per attempt: time, item, node, right or not, the answer typed (first 80 characters) |
| `state/<student>.json` | Nodes opened and nodes flagged |
| `teacher-key.txt` | Only if `TEACHER_KEY` was not set |

Names never leave this disk. A personal link is a secret: anyone who has it can act as that student. "New link" in the roster replaces it.

## Courses

Each file in `courses/` ending in `.course.txt` is one course, shown in file-name order. Edit a file and redeploy to change a course. Node ids must stay as they are once students have progress on them.

## Run locally

`DATA_DIR=./data TEACHER_KEY=test node server.js`, then open `http://localhost:3000/teach`.
