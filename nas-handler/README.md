# Opening NAS files from the project system

Documents in the system store the **address** of a drawing on the office NAS, not a copy
of it. This folder is what turns that address into one click on an office PC.

## Why anything needs installing at all

A browser will not open `\\NAS01\Projects\…` from a web page. Chrome and Edge block it,
it is a security boundary rather than a setting, and being on the same network makes no
difference. So the Documents page offers two routes to the same file:

| | Needs installing | How it behaves |
|---|---|---|
| **Copy path** | Nothing | Copies the full path. Paste into File Explorer (`Win`+`E`, `Ctrl`+`V`, `Enter`). |
| **Open / Open folder** | This folder, once per PC | Opens the real file on the NAS straight away. |
| **Browse…** | This folder, once per PC | Opens a Windows file dialog on the NAS and fills the path in for you. |

Copy path works everywhere, on any machine, forever. The installer is a convenience on
top of it — worth doing on the office machines, not worth chasing on a laptop somebody
uses twice a year.

Either way the file opens **in place on the NAS**, so edits save back to the original.
Nothing is ever downloaded to the person's PC, which is the point: one copy of A-101.

## Choosing a file: why it takes two clicks

Adding a document goes: **Browse…** → pick the file in the Windows dialog → **Use picked
file**. The path and a suggested document name appear in the form.

The second click is not an oversight. A web page cannot learn a file's path — a normal
file input hands back the file's *contents* and its name, and reports the path as the
literal string `C:\fakepath\A-101.pdf`. That is required by the HTML standard so that
websites cannot map your disk, and no browser setting changes it.

So the dialog runs in the handler, which is an ordinary Windows program with no such
limit. But Windows can only *launch* a handler — it gives it no way to answer the page
that asked. The path therefore comes back on the clipboard, and the second click is the
page reading it. Chrome asks permission for that once per machine; allow it and it stops
asking.

What the handler writes is stamped with the time, and the page refuses anything older
than two minutes. That is what stops a cancelled dialog from quietly attaching the last
drawing somebody picked — the wrong file on the right project is exactly the sort of
mistake nobody would notice.

If the dialog is used to browse somewhere off the share, the pick is refused. The system
can only link to files under the share root, because a path on somebody's own C: drive
means nothing to anyone else in the practice.

Typing or pasting a path still works and needs none of this. Explorer's **Copy as path**
(Shift+right-click a file) pastes straight into the field, quotes and all.

## Installing

**Do this once, by whoever sets it up:** copy this folder onto the share somewhere
everyone can read, and create a file next to `install.cmd` called `nas-root.txt`
containing one line — the share root:

```
\\NAS01\Projects
```

**Then, on each PC:** open that folder from the share and double-click **`install.cmd`**.
That is the whole procedure. It reads the root from `nas-root.txt`, so nobody types a
path, and no administrator rights are needed — the `nhn://` scheme is registered under
the current user only.

The first time someone clicks an open button, the browser asks whether to allow the link
to open the app. Tick "always allow" and it stops asking.

### Checking before you commit to it

```bash
install.cmd -DryRun
```

Prints exactly what it would register and changes nothing. Worth running once before
going round twelve machines.

### Central mode: don't copy the handler at all

```bash
install.cmd -FromShare
```

Registers the handler **where it sits on the share** instead of copying it into the user
profile. The advantage is real: fixing or changing the handler later becomes one edit on
the NAS rather than another visit to every machine. The share root also lives in one file
instead of one per PC.

The trade-off is equally real. Anyone who can write to that folder can change a script
that then runs on every PC in the practice, so **put it somewhere only whoever maintains
this can write to.** A read-only share for everyone else is the right setup. If the whole
office has write access to it, use the default local mode instead.

Central mode also means the handler stops working when the share is unreachable — which
matters less than it sounds, since the files it opens are on that same share.

### Doing it without visiting machines at all

If the firm is on a Windows domain, Group Policy Preferences can push the same two
registry values and skip the per-PC step entirely. The values are shown by `-DryRun`.

Without a domain, `install.cmd` on the share is the practical answer — it is a
double-click, so it can be sent round in an email rather than done in person.

### Removing it

```bash
powershell -ExecutionPolicy Bypass -File uninstall.ps1
```

Nothing in the PM system breaks: paths and the copy button keep working. Only the
one-click open and browse buttons stop.

## Use the network path, not a drive letter

`-NasRoot` wants `\\NAS01\Projects`. Not `P:\`. Drive letters are per-machine — whoever
mapped `P:` mapped it themselves, someone else used `S:`, and a new starter has neither.
The network path is identical everywhere, and the installer refuses a drive letter.

## The root is stored twice, deliberately

The share root lives in two places:

- **In the app** — Documents → the gear beside "Add Document". This is what gets
  displayed and copied to the clipboard.
- **On each PC** — `%LOCALAPPDATA%\NHN PM\nas-root.txt`, written by `install.ps1`. This
  is what the handler trusts.

That is not an oversight. The handler must not take the root from the link, because a
root arriving from a web page is a root that whoever wrote the link gets to choose —
and the handler opens files with it. Keeping a local copy is what makes the link safe to
act on.

**If the share is ever renamed or the NAS replaced, change both.** The app setting
repoints every document at once; the PCs need `install.ps1` re-run with the new root.

## What the handler will and will not open

It opens documents: PDFs, CAD files, Office files, images, archives, video.

Anything else — an `.exe`, `.bat`, `.ps1`, `.lnk`, or any extension not on the list in
`open-nas-path.ps1` — is **revealed in Explorer instead of launched**. A link in a web
page must never be able to start a program on an office PC, and that holds even if
someone with access to the Documents page tries it deliberately.

The handler also refuses any path that resolves outside the share root, checked after
the path is canonicalised rather than just pattern-matched, so `..` tricks do not work.

## When a link stops working

The most common failure is nothing to do with this folder: **somebody moved or renamed
the file on the NAS**. The system stores a path, and nothing on the NAS tells it when
that path changes, so the link quietly points at nothing until someone clicks it.

The handler says so plainly when it happens, naming the path it looked for. The fix is
to update the document in the Documents page — or to agree that project folders get
reorganised through one person rather than by whoever is tidying up.

## One thing this cannot enforce

The system knows which projects are confidential and hides them accordingly. The NAS has
its own share permissions, and they are a separate system that knows nothing about the
first one.

A confidential project can hold a link to a folder the whole office can browse. The
document row will be hidden from everyone it should be; the folder it points at will not.
If confidentiality matters on a project, the NAS folder permissions have to be set to
match, by hand.
