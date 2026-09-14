# Changelog

## 0.1.0 — 2026-09-14

- Tauri v2 desktop client for Jira Server / Data Center 10.3 (PAT or basic auth).
- Disk cache with stale-while-revalidate: issues open instantly, refresh in background.
- Jira context paths (e.g. `/jira`) supported.
- Sidebar: saved views, favourite filters, projects tree with open issues and boards.
- Issue list with search by text, key or JQL; prefetches next issues.
- Detail view with big description and comments; focus mode and fullscreen (`f`, F11).
- Server-rendered descriptions/comments shown as sanitized HTML; authenticated images.
- Zoomable images in descriptions, comments and attachments (fullscreen lightbox).
- Keyboard shortcuts throughout, with `?` help overlay; font size `Ctrl +/-`.
- Add comments; transition status; assign to me.
- Edit issues in a fullscreen zen editor: summary + description only.
- Fields drawer (`Ctrl+B`) with every edit-screen field, custom fields included.
- Create issues with project, type and parent from `createmeta` (Jira 10 paged endpoints).
- Rich-text description editor (TipTap) converting to/from Jira wiki markup.
- Raw markup mode (`Ctrl+P`) with warning when rich mode would lose formatting.
- Autocomplete pickers: labels, users, components, versions, priorities, selects, sprints, issues.
- Kanban and scrum boards from `/rest/agile/1.0` using the board's column mapping.
- Done-column window filter: last 30 days, last year, all.
- Boards nested under their project; fallback to config location or filter JQL.
- Board search filters only the current board's cards.
- Project-scoped search stays inside the project's open issues.
- Star projects and boards to pin them to the top.
- Creating from a board pre-fills its project and required labels.
- New-issue form is typeable immediately; fields sidebar loads separately.
- Paste from Markdown: clipboard Markdown converted to Jira markup.
- Copy description with formatting, as Jira markup, or as Markdown.
- CI builds Linux, Windows and macOS (arm64, x86_64) bundles; tags draft a release.
