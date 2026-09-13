// Minimal mock of the Jira Server / Data Center 10.3 REST API v2, for local
// development of jirafast without a real Jira. Served under a `/jira` context
// path to exercise that code path. Zero dependencies.
//
//   node dev/mock-jira/server.mjs            # http://127.0.0.1:8080/jira
//   PORT=9000 node dev/mock-jira/server.mjs
//
// Accepts any PAT (Bearer) or basic credentials except the literal token
// "bad", which returns 401 so the error path can be exercised. Adds an
// artificial latency (MOCK_LATENCY_MS, default 250) so cache hits are visible.

import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT ?? 8080);
const LATENCY = Number(process.env.MOCK_LATENCY_MS ?? 250);
const CTX = "/jira";
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}${CTX}`;

// ---- fixtures --------------------------------------------------------------

const users = {
  jdoe: user("jdoe", "Jane Doe", "jdoe@example.com", 10100),
  bob: user("bob", "Bob Builder", "bob@example.com", 10101),
  alice: user("alice", "Alice Ops", "alice@example.com", 10102),
};
const ME = users.jdoe;

function user(name, displayName, email, avatarId) {
  return {
    self: `${BASE}/rest/api/2/user?username=${name}`,
    name,
    key: `JIRAUSER${avatarId}`,
    displayName,
    emailAddress: email,
    active: true,
    timeZone: "UTC",
    avatarUrls: {
      "16x16": `${BASE}/secure/useravatar?size=xsmall&avatarId=${avatarId}`,
      "24x24": `${BASE}/secure/useravatar?size=small&avatarId=${avatarId}`,
      "32x32": `${BASE}/secure/useravatar?size=medium&avatarId=${avatarId}`,
      "48x48": `${BASE}/secure/useravatar?avatarId=${avatarId}`,
    },
  };
}

const statuses = {
  todo: status("10000", "To Do", 2, "new", "blue-gray", "To Do"),
  progress: status("3", "In Progress", 4, "indeterminate", "yellow", "In Progress"),
  review: status("10001", "In Review", 4, "indeterminate", "yellow", "In Progress"),
  done: status("10002", "Done", 3, "done", "green", "Done"),
};
function status(id, name, catId, key, colorName, catName) {
  return {
    self: `${BASE}/rest/api/2/status/${id}`,
    id,
    name,
    description: "",
    iconUrl: `${BASE}/images/icons/statuses/generic.png`,
    statusCategory: { self: `${BASE}/rest/api/2/statuscategory/${catId}`, id: catId, key, colorName, name: catName },
  };
}

const types = {
  bug: itype("1", "Bug", 10303, false),
  story: itype("10001", "Story", 10315, false),
  task: itype("10002", "Task", 10318, false),
  sub: itype("10003", "Sub-task", 10316, true),
  epic: itype("10000", "Epic", 10307, false),
};
function itype(id, name, avatarId, subtask) {
  return { self: `${BASE}/rest/api/2/issuetype/${id}`, id, name, subtask, iconUrl: `${BASE}/secure/viewavatar?size=xsmall&avatarId=${avatarId}&avatarType=issuetype`, description: "" };
}

const priorities = {
  highest: prio("1", "Highest"),
  high: prio("2", "High"),
  medium: prio("3", "Medium"),
  low: prio("4", "Low"),
};
function prio(id, name) {
  return { self: `${BASE}/rest/api/2/priority/${id}`, id, name, iconUrl: `${BASE}/images/icons/priorities/${name.toLowerCase()}.svg` };
}

const projects = [
  project("10000", "PLAT", "Platform", 10400),
  project("10001", "WEB", "Web Frontend", 10401),
  project("10002", "OPS", "Operations", 10402),
];
function project(id, key, name, avatarId) {
  return {
    self: `${BASE}/rest/api/2/project/${id}`,
    id,
    key,
    name,
    projectTypeKey: "software",
    avatarUrls: {
      "48x48": `${BASE}/secure/projectavatar?pid=${id}&avatarId=${avatarId}`,
      "24x24": `${BASE}/secure/projectavatar?size=small&pid=${id}&avatarId=${avatarId}`,
      "16x16": `${BASE}/secure/projectavatar?size=xsmall&pid=${id}&avatarId=${avatarId}`,
      "32x32": `${BASE}/secure/projectavatar?size=medium&pid=${id}&avatarId=${avatarId}`,
    },
  };
}

const filters = [
  { id: "10100", name: "Sprint board", jql: "project = PLAT AND sprint in openSprints() ORDER BY rank", favourite: true, owner: ME },
  { id: "10101", name: "Bugs needing triage", jql: "type = Bug AND status = 'To Do' ORDER BY priority DESC", favourite: true, owner: ME },
  { id: "10102", name: "Waiting on review", jql: "status = 'In Review' ORDER BY updated DESC", favourite: true, owner: users.bob },
].map((f) => ({ ...f, self: `${BASE}/rest/api/2/filter/${f.id}`, description: "", viewUrl: `${BASE}/issues/?filter=${f.id}`, searchUrl: `${BASE}/rest/api/2/search?jql=${encodeURIComponent(f.jql)}` }));

const LOREM = [
  "The pipeline intermittently fails when the artifact cache is warm but the lockfile changed on a branch with a merge commit.",
  "Customers report that opening an issue with more than 200 comments takes over eight seconds in the browser.",
  "We should render server-side HTML directly instead of shipping the whole front-end bundle for every navigation.",
  "Reproduced on Jira 10.3.2 with the default theme. Does not reproduce on 9.12.",
  "Attached a HAR file and a screenshot of the network panel; most of the time is spent in `batch.js`.",
  "Proposal: cache rendered fields on disk keyed by issue key + updated timestamp, and revalidate in the background.",
];
const pick = (arr, i) => arr[i % arr.length];

const opt = (id, value) => ({ self: `${BASE}/rest/api/2/customFieldOption/${id}`, id: String(id), value });
const CUSTOM_OPTIONS = {
  severity: [opt(10200, "S1 - Critical"), opt(10201, "S2 - Major"), opt(10202, "S3 - Minor")],
  platform: [opt(10210, "Linux"), opt(10211, "Windows"), opt(10212, "macOS")],
  area: [
    { ...opt(10220, "Backend"), children: [opt(10221, "REST"), opt(10222, "Cache")] },
    { ...opt(10223, "Frontend"), children: [opt(10224, "Editor"), opt(10225, "Board")] },
  ],
};
const CF = "com.atlassian.jira.plugin.system.customfieldtypes:";

let nextCommentId = 20000;
const issues = new Map();
const projectCounters = new Map();

function mkIssue({ proj, type, summary, status, priority, assignee, reporter, labels = [], components = [], description, comments = [], attachments = [], parent, daysAgo = 3 }) {
  const n = (projectCounters.get(proj.key) ?? 0) + 1;
  projectCounters.set(proj.key, n);
  const key = `${proj.key}-${n}`;
  const id = String(10000 + issues.size);
  const created = daysAgoIso(daysAgo + 2);
  const updated = daysAgoIso(daysAgo);
  const issue = {
    id,
    key,
    self: `${BASE}/rest/api/2/issue/${id}`,
    fields: {
      summary,
      description,
      issuetype: type,
      status,
      priority,
      assignee,
      reporter,
      creator: reporter,
      project: proj,
      labels,
      components: components.map((c, i) => ({ id: String(11000 + i), name: c, self: `${BASE}/rest/api/2/component/${11000 + i}` })),
      fixVersions: n % 3 === 0 ? [{ id: "12000", name: "10.4.0", released: false }] : [],
      versions: [],
      created,
      updated,
      duedate: n % 4 === 0 ? daysAgoIso(-7).slice(0, 10) : null,
      resolution: status === statuses.done ? { id: "10000", name: "Done", description: "Work has been completed on this issue." } : null,
      resolutiondate: status === statuses.done ? updated : null,
      environment: n % 5 === 0 ? "Jira Data Center 10.3.2 on RHEL 9, PostgreSQL 15, behind nginx." : null,
      parent,
      subtasks: [],
      issuelinks: [],
      attachment: attachments,
      comment: { comments, maxResults: comments.length, total: comments.length, startAt: 0 },
      watches: { self: `${BASE}/rest/api/2/issue/${key}/watchers`, watchCount: 2, isWatching: n % 2 === 0 },
      votes: { self: `${BASE}/rest/api/2/issue/${key}/votes`, votes: 0, hasVoted: false },
      timetracking: n % 3 === 0 ? { originalEstimate: "2d", remainingEstimate: "1d 4h", timeSpent: "4h" } : {},
      customfield_10016: n % 2 ? 3 : 5, // story points
      customfield_10100: pick([null, CUSTOM_OPTIONS.severity[0], CUSTOM_OPTIONS.severity[1]], n), // single select
      customfield_10101: n % 2 ? [CUSTOM_OPTIONS.platform[0], CUSTOM_OPTIONS.platform[2]] : [], // multi checkboxes
      customfield_10102: n % 3 === 0 ? "Reproduced on staging with the *default* config." : null, // textarea
      customfield_10103: n % 4 === 0 ? daysAgoIso(-3) : null, // datetime
      customfield_10104: n % 2 ? users.alice : null, // user picker
      customfield_10105: n % 3 === 1 ? { ...opt(10220, "Backend"), child: CUSTOM_OPTIONS.area[0].children[1] } : null, // cascading
      customfield_10106: `https://example.com/ticket/${n}`, // url
      customfield_10107: n % 2 ? [users.bob] : [], // multi user
    },
  };
  issues.set(key, issue);
  return issue;
}

function daysAgoIso(days) {
  const d = new Date(Date.now() - days * 86400_000);
  // Jira Server format: 2024-05-01T12:34:56.000+0000
  return d.toISOString().replace("Z", "+0000");
}

function mkComment(author, body, daysAgo) {
  const id = String(nextCommentId++);
  const created = daysAgoIso(daysAgo);
  return { self: `${BASE}/rest/api/2/issue/10000/comment/${id}`, id, author, updateAuthor: author, body, created, updated: created };
}

function mkAttachment(id, filename, mimeType, size, author) {
  return {
    self: `${BASE}/rest/api/2/attachment/${id}`,
    id: String(id),
    filename,
    author,
    created: daysAgoIso(4),
    size,
    mimeType,
    content: `${BASE}/secure/attachment/${id}/${encodeURIComponent(filename)}`,
    thumbnail: mimeType.startsWith("image/") ? `${BASE}/secure/thumbnail/${id}/_thumb_${id}.png` : undefined,
  };
}

// The big one: a long description and lots of comments so the "big
// description/comments" UI can be evaluated.
const bigDescription = `h2. Summary

Opening an issue in the Jira web UI on *10.3.2* is slow: the page ships ~4 MB of JavaScript before the description is visible. This ticket tracks a fast native client.

h2. Steps to reproduce

# Open any issue with more than 50 comments
# Watch the network panel
# Note that {{batch.js}} blocks first paint for 3-8 seconds

h2. Expected

Description and comments visible in under 200 ms from a warm cache.

{code:title=Bash|borderStyle=solid}
curl -s -H "Authorization: Bearer $JIRA_PAT" \\
  "https://jira.example.com/rest/api/2/issue/PLAT-1?expand=renderedFields" | jq .renderedFields.description
{code}

{panel:title=Note|borderStyle=dashed|borderColor=#ccc|titleBGColor=#F7D6C1|bgColor=#FFFFCE}
Rendered fields come back as HTML, so we can show them directly.
{panel}

||Endpoint||Cold (ms)||Warm (ms)||
|/rest/api/2/search|420|180|
|/rest/api/2/issue/KEY|310|95|

!screenshot.png|thumbnail!

See also PLAT-2 and [the REST docs|https://docs.atlassian.com/software/jira/docs/api/REST/10.3.2/].

Mentions: [~bob] please take a look.`;

const bigDescriptionHtml = `<h2><a name="Summary"></a>Summary</h2>
<p>Opening an issue in the Jira web UI on <b>10.3.2</b> is slow: the page ships ~4 MB of JavaScript before the description is visible. This ticket tracks a fast native client.</p>
<h2><a name="Stepstoreproduce"></a>Steps to reproduce</h2>
<ol>
	<li>Open any issue with more than 50 comments</li>
	<li>Watch the network panel</li>
	<li>Note that <tt>batch.js</tt> blocks first paint for 3-8 seconds</li>
</ol>
<h2><a name="Expected"></a>Expected</h2>
<p>Description and comments visible in under 200 ms from a warm cache.</p>
<div class="code panel" style="border-style: solid;border-width: 1px;"><div class="codeHeader panelHeader" style="border-bottom-width: 1px;border-bottom-style: solid;"><b>Bash</b></div><div class="codeContent panelContent">
<pre class="code-java">curl -s -H <span class="code-quote">"Authorization: Bearer $JIRA_PAT"</span> \\
  <span class="code-quote">"https://jira.example.com/rest/api/2/issue/PLAT-1?expand=renderedFields"</span> | jq .renderedFields.description</pre>
</div></div>
<div class="panel" style="background-color: #FFFFCE;border-color: #ccc;border-style: dashed;border-width: 1px;"><div class="panelHeader" style="border-bottom-width: 1px;border-bottom-style: dashed;border-bottom-color: #ccc;background-color: #F7D6C1;"><b>Note</b></div><div class="panelContent" style="background-color: #FFFFCE;">
<p>Rendered fields come back as HTML, so we can show them directly.</p>
</div></div>
<div class='table-wrap'>
<table class='confluenceTable'><tbody>
<tr><th class='confluenceTh'>Endpoint</th><th class='confluenceTh'>Cold (ms)</th><th class='confluenceTh'>Warm (ms)</th></tr>
<tr><td class='confluenceTd'>/rest/api/2/search</td><td class='confluenceTd'>420</td><td class='confluenceTd'>180</td></tr>
<tr><td class='confluenceTd'>/rest/api/2/issue/KEY</td><td class='confluenceTd'>310</td><td class='confluenceTd'>95</td></tr>
</tbody></table>
</div>
<p><span class="image-wrap" style=""><a href="${CTX}/secure/attachment/30001/screenshot.png" title="screenshot.png"><img src="${CTX}/secure/thumbnail/30001/_thumb_30001.png" alt="screenshot.png" style="border: 0px solid black" /></a></span></p>
<p>See also <a href="${CTX}/browse/PLAT-2" title="Cache rendered fields on disk" class="issue-link" data-issue-key="PLAT-2"><del>PLAT-2</del></a> and <a href="https://docs.atlassian.com/software/jira/docs/api/REST/10.3.2/" class="external-link" rel="nofollow">the REST docs</a>.</p>
<p>Mentions: <a class="user-hover" rel="bob" id="user_bob" href="${CTX}/secure/ViewProfile.jspa?name=bob">Bob Builder</a> please take a look.</p>
<p><span class="jira-issue-macro"><span class="aui-lozenge aui-lozenge-subtle aui-lozenge-complete">Done</span></span></p>`;

function renderWiki(text) {
  // Extremely small subset of Jira wiki -> HTML, good enough for the mock.
  if (text == null) return null;
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const esc = para.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const code = esc.match(/^\{code(?::[^}]*)?\}\n?([\s\S]*?)\n?\{code\}$/);
      if (code) return `<div class="code panel"><div class="codeContent panelContent"><pre class="code-java">${code[1]}</pre></div></div>`;
      const heading = esc.match(/^h([1-6])\.\s+(.*)$/);
      if (heading) return `<h${heading[1]}>${inline(heading[2])}</h${heading[1]}>`;
      if (esc.split("\n").every((l) => /^\|/.test(l))) {
        const rows = esc.split("\n").map((l) => {
          const header = l.startsWith("||");
          const cells = l.split(header ? "||" : "|").slice(1, -1);
          const tag = header ? "th" : "td";
          const cls = header ? "confluenceTh" : "confluenceTd";
          return `<tr>${cells.map((c) => `<${tag} class='${cls}'>${inline(c.trim())}</${tag}>`).join("")}</tr>`;
        });
        return `<div class='table-wrap'><table class='confluenceTable'><tbody>${rows.join("")}</tbody></table></div>`;
      }
      const thumb = esc.match(/^!([^|!]+)\|thumbnail!$/);
      if (thumb) {
        const att = [...issues.values()].flatMap((i) => i.fields.attachment ?? []).find((a) => a.filename === thumb[1]);
        if (att) {
          return `<p><span class="image-wrap" style=""><a href="${CTX}/secure/attachment/${att.id}/${att.filename}" title="${att.filename}"><img src="${CTX}/secure/thumbnail/${att.id}/_thumb_${att.id}.png" alt="${att.filename}" style="border: 0px solid black" /></a></span></p>`;
        }
      }
      if (/^(\*|#|-) /m.test(esc) && esc.split("\n").every((l) => /^(\*|#|-) /.test(l))) {
        const tag = esc.startsWith("# ") ? "ol" : "ul";
        return `<${tag}>${esc.split("\n").map((l) => `<li>${l.slice(2)}</li>`).join("")}</${tag}>`;
      }
      return `<p>${inline(esc).replace(/\n/g, "<br/>")}</p>`;
    })
    .join("\n");
}

function inline(esc) {
  return esc
    .replace(/\{color:([#\w]+)\}([\s\S]*?)\{color\}/g, '<font color="$1">$2</font>')
    .replace(/\{\{([^}]+)\}\}/g, "<tt>$1</tt>")
    .replace(/\[([^\]|]+)\|(https?:[^\]]+)\]/g, '<a href="$2" class="external-link" rel="nofollow">$1</a>')
    .replace(/\[~([a-z]+)\]/g, (_m, u) => `<a class="user-hover" rel="${u}" href="${CTX}/secure/ViewProfile.jspa?name=${u}">${users[u]?.displayName ?? u}</a>`)
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,;:!?])/g, "$1<b>$2</b>")
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:!?])/g, "$1<em>$2</em>")
    .replace(/(^|\s)\+([^+\n]+)\+(?=\s|$|[.,;:!?])/g, "$1<ins>$2</ins>")
    .replace(/(^|\s)-([^-\n]+)-(?=\s|$|[.,;:!?])/g, "$1<del>$2</del>")
    .replace(/\b([A-Z]{2,5}-\d+)\b/g, (_m, k) => (issues.has(k) ? `<a href="${CTX}/browse/${k}" class="issue-link" data-issue-key="${k}">${k}</a>` : k));
}

const authorsCycle = [users.bob, users.alice, users.jdoe];
const bigComments = Array.from({ length: 60 }, (_, i) =>
  mkComment(
    pick(authorsCycle, i),
    i % 9 === 8
      ? `{code:java}\npublic class Slow {\n    // ${pick(LOREM, i)}\n    void render() { for (int n = 0; n < 200; n++) paint(n); }\n}\n{code}`
      : i === 1
        ? `Screenshot of the network panel:\n\n!screenshot.png|thumbnail!\n\nand the profile:\n\n!profile.svg|thumbnail!`
        : `${pick(LOREM, i)}\n\n${pick(LOREM, i + 3)} See PLAT-${(i % 6) + 2}. ${i % 4 === 0 ? "[~jdoe] thoughts?" : ""}`,
    (60 - i) * 0.4,
  ),
);

const big = mkIssue({
  proj: projects[0],
  type: types.story,
  summary: "Build a very fast native desktop client for Jira Data Center 10.3",
  status: statuses.progress,
  priority: priorities.highest,
  assignee: ME,
  reporter: users.alice,
  labels: ["performance", "desktop", "tauri"],
  components: ["Client", "REST API"],
  description: bigDescription,
  comments: bigComments,
  attachments: [
    mkAttachment(30001, "screenshot.png", "image/png", 184_223, users.alice),
    mkAttachment(30002, "network.har", "application/json", 2_931_004, users.alice),
    mkAttachment(30003, "profile.svg", "image/svg+xml", 40_120, users.bob),
  ],
  daysAgo: 0.1,
});
big.renderedDescription = bigDescriptionHtml;

const cacheIssue = mkIssue({
  proj: projects[0],
  type: types.task,
  summary: "Cache rendered fields on disk keyed by issue key + updated timestamp",
  status: statuses.done,
  priority: priorities.high,
  assignee: users.bob,
  reporter: ME,
  labels: ["performance"],
  description: `Store the JSON of {{/rest/api/2/issue/KEY?expand=renderedFields}} under the app cache dir.\n\nRevalidate in the background and emit an event when the fresh copy differs. Related to ${big.key}.`,
  comments: [mkComment(users.bob, "Done in the Rust backend, two-level cache (memory + disk).", 1), mkComment(ME, "Nice, verified locally. *Ship it.*", 0.5)],
  daysAgo: 0.5,
});

for (let i = 0; i < 38; i++) {
  const proj = pick(projects, i);
  const type = pick([types.bug, types.task, types.story, types.bug, types.epic], i);
  const st = pick([statuses.todo, statuses.progress, statuses.review, statuses.done, statuses.todo], i);
  mkIssue({
    proj,
    type,
    summary: pick(
      [
        "Search results pagination drops the last page when total is a multiple of 50",
        "Keyboard shortcut `f` should toggle focus mode even when the list has focus",
        "Attachment thumbnails require authentication; route them through the asset protocol",
        "Support Jira instances under a context path (/jira)",
        "PAT authentication returns 401 when the token has trailing whitespace",
        "Dark theme: lozenge colors are hard to read on In Progress statuses",
        "Rendered comment HTML contains inline event handlers – sanitize",
        "Prefetch the next three issues after selection changes",
        "Add 'Assign to me' button on the issue header",
        "Show subtasks and linked issues in the detail view",
        "Zoom in/out with Ctrl+/- for large monitors",
        "Long descriptions: allow full-window reading with F11",
        "Investigate HTTP/2 connection reuse against nginx front-end",
      ],
      i,
    ),
    status: st,
    priority: pick([priorities.medium, priorities.high, priorities.low, priorities.highest], i),
    assignee: pick([ME, users.bob, null, users.alice, ME], i),
    reporter: pick([users.alice, ME, users.bob], i + 1),
    labels: i % 3 ? ["frontend"] : ["backend", "needs-review"],
    description: i % 4 === 3 ? null : `${pick(LOREM, i)}\n\n${pick(LOREM, i + 2)}\n\nSee ${big.key} for context.`,
    comments: Array.from({ length: i % 5 }, (_, c) => mkComment(pick(authorsCycle, c + i), pick(LOREM, c + i), (i % 5) - c)),
    daysAgo: i * 0.7 + 1,
  });
}

// Completed long ago, so the kanban "done column" window (30 days / 1 year /
// all) has something to hide at each step.
for (const [i, daysAgo] of [45, 120, 200, 400, 700].entries()) {
  mkIssue({
    proj: pick(projects, i),
    type: pick([types.task, types.bug, types.story], i),
    summary: `Legacy: ${pick(["migrate CI to containers", "drop Java 8 support", "remove the old REST v1 client", "upgrade PostgreSQL to 15", "retire the Confluence macro"], i)}`,
    status: statuses.done,
    priority: priorities.low,
    assignee: pick([users.bob, users.alice], i),
    reporter: ME,
    labels: ["legacy"],
    description: `Completed ${daysAgo} days ago.`,
    daysAgo,
  });
}

// Subtasks + links for the big issue.
const sub1 = mkIssue({ proj: projects[0], type: types.sub, summary: "Rust: reqwest client with PAT/basic auth", status: statuses.done, priority: priorities.medium, assignee: ME, reporter: ME, description: "Done.", parent: linkRef(big), daysAgo: 0.3 });
const sub2 = mkIssue({ proj: projects[0], type: types.sub, summary: "Svelte: focus mode + fullscreen", status: statuses.progress, priority: priorities.medium, assignee: ME, reporter: ME, description: "In progress.", parent: linkRef(big), daysAgo: 0.2 });
big.fields.subtasks = [linkRef(sub1), linkRef(sub2)];
big.fields.issuelinks = [
  { id: "40001", self: `${BASE}/rest/api/2/issueLink/40001`, type: { id: "10000", name: "Blocks", inward: "is blocked by", outward: "blocks" }, outwardIssue: linkRef(cacheIssue) },
  { id: "40002", self: `${BASE}/rest/api/2/issueLink/40002`, type: { id: "10001", name: "Relates", inward: "relates to", outward: "relates to" }, inwardIssue: linkRef(issues.get("WEB-1")) },
];

function linkRef(i) {
  return { id: i.id, key: i.key, self: i.self, fields: { summary: i.fields.summary, status: i.fields.status, priority: i.fields.priority, issuetype: i.fields.issuetype } };
}

// ---- agile boards ----------------------------------------------------------

const boards = [
  mkBoard(1, "Platform board", "kanban", projects[0], [["To Do", [statuses.todo]], ["In Progress", [statuses.progress, statuses.review]], ["Done", [statuses.done]]]),
  mkBoard(2, "Web Frontend", "kanban", projects[1], [["Backlog", [statuses.todo]], ["In Progress", [statuses.progress]], ["Review", [statuses.review]], ["Done", [statuses.done]]]),
  mkBoard(3, "OPS Scrum", "scrum", projects[2], [["To Do", [statuses.todo]], ["In Progress", [statuses.progress, statuses.review]], ["Done", [statuses.done]]]),
];

function mkBoard(id, name, type, proj, columns) {
  const self = `${BASE}/rest/agile/1.0/board/${id}`;
  return {
    summary: { id, self, name, type, location: { projectId: Number(proj.id), displayName: `${proj.name} (${proj.key})`, projectName: proj.name, projectKey: proj.key, projectTypeKey: "software", avatarURI: proj.avatarUrls["16x16"], name: `${proj.name} (${proj.key})` } },
    jql: `project = ${proj.key} ORDER BY Rank ASC`,
    configuration: {
      id,
      name,
      type,
      self: `${self}/configuration`,
      location: { type: "project", key: proj.key, id: proj.id, self: proj.self, name: proj.name },
      filter: { id: String(10200 + id), self: `${BASE}/rest/api/2/filter/${10200 + id}` },
      subQuery: type === "kanban" ? { query: "fixVersion in unreleasedVersions() OR fixVersion is EMPTY" } : undefined,
      columnConfig: {
        columns: columns.map(([cname, sts]) => ({ name: cname, statuses: sts.map((s) => ({ id: s.id, self: s.self })) })),
        constraintType: "issueCount",
      },
      estimation: { type: "field", field: { fieldId: "customfield_10016", displayName: "Story Points" } },
      ranking: { rankCustomFieldId: 10019 },
    },
  };
}

// ---- transitions -----------------------------------------------------------

function transitionsFor(issue) {
  const cur = issue.fields.status;
  const all = [
    { id: "11", name: "To Do", to: statuses.todo },
    { id: "21", name: "Start Progress", to: statuses.progress },
    { id: "31", name: "Send to Review", to: statuses.review },
    { id: "41", name: "Done", to: statuses.done },
  ];
  return all.filter((t) => t.to !== cur).map((t) => ({ ...t, hasScreen: false, isGlobal: true, isInitial: false, fields: {} }));
}

// ---- JQL (tiny subset) -----------------------------------------------------

function runJql(jql) {
  const q = (jql ?? "").trim();
  let list = [...issues.values()];
  const lower = q.toLowerCase();
  const m = (re) => lower.match(re)?.[1];

  const proj = m(/project\s*=\s*"?([a-z]+)"?/);
  if (proj) list = list.filter((i) => i.fields.project.key.toLowerCase() === proj);
  if (/assignee\s*=\s*currentuser\(\)/.test(lower)) list = list.filter((i) => i.fields.assignee?.name === ME.name);
  if (/reporter\s*=\s*currentuser\(\)/.test(lower)) list = list.filter((i) => i.fields.reporter?.name === ME.name);
  if (/watcher\s*=\s*currentuser\(\)/.test(lower)) list = list.filter((i) => i.fields.watches.isWatching);
  if (/resolution\s*=\s*unresolved/.test(lower)) list = list.filter((i) => !i.fields.resolution);
  const st = m(/status\s*=\s*['"]?([a-z ]+?)['"]?(?:\s|$|and|order)/);
  if (st) list = list.filter((i) => i.fields.status.name.toLowerCase() === st.trim());
  // The kanban done-column window jirafast sends:
  //   status not in (<ids>) OR resolutiondate >= -Nd OR (resolution is EMPTY AND updated >= -Nd)
  const dw = lower.match(/status\s+not\s+in\s*\(([\d,\s]+)\)\s+or\s+resolutiondate\s*>=\s*-(\d+)d/);
  if (dw) {
    const ids = dw[1].split(",").map((s) => s.trim());
    const cutoff = Date.now() - Number(dw[2]) * 86400_000;
    list = list.filter((i) => !ids.includes(i.fields.status.id) || parseJiraDate(i.fields.resolutiondate ?? i.fields.updated) >= cutoff);
  }
  const type = m(/(?:type|issuetype)\s*=\s*['"]?([a-z-]+)['"]?/);
  if (type) list = list.filter((i) => i.fields.issuetype.name.toLowerCase() === type);
  const text = q.match(/text\s*~\s*"((?:[^"\\]|\\.)*)"/i)?.[1];
  if (text) {
    const t = text.replace(/\\"/g, '"').toLowerCase();
    list = list.filter((i) => `${i.key} ${i.fields.summary} ${i.fields.description ?? ""}`.toLowerCase().includes(t));
  }
  const key = m(/(?:issuekey|key|issue)\s*=\s*"?([a-z]+-\d+)"?/);
  if (key) list = list.filter((i) => i.key.toLowerCase() === key);
  if (/issuehistory\(\)/.test(lower)) list = list.slice(0, 12);

  const orderBy = lower.match(/order\s+by\s+(\w+)\s*(asc|desc)?/);
  const field = orderBy?.[1] ?? "updated";
  const dir = (orderBy?.[2] ?? "desc") === "desc" ? -1 : 1;
  const val = (i) => {
    switch (field) {
      case "created":
        return i.fields.created;
      case "priority":
        return -Number(i.fields.priority.id);
      case "key":
      case "issuekey":
        return i.key;
      case "rank":
        return Number(i.id);
      default:
        return i.fields.updated;
    }
  };
  list.sort((a, b) => (val(a) < val(b) ? -dir : val(a) > val(b) ? dir : 0));
  return list;
}

function parseJiraDate(s) {
  return Date.parse(String(s).replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

function projectIssue(issue, fields) {
  if (!fields || fields.includes("*all")) return issue.fields;
  const out = {};
  for (const f of fields) if (f in issue.fields) out[f] = issue.fields[f];
  return out;
}

function componentsFor(proj) {
  const names = { PLAT: ["Client", "REST API", "Cache"], WEB: ["UI", "Build"], OPS: ["Infra"] }[proj.key] ?? [];
  return names.map((name, i) => ({ id: String(11000 + i), name, self: `${BASE}/rest/api/2/component/${11000 + i}` }));
}

// Field metadata in the shape of `editmeta` / `createmeta` (Jira Server).
function fieldMeta(proj, { forCreate = false, type = null } = {}) {
  const f = {
    summary: { required: true, schema: { type: "string", system: "summary" }, name: "Summary", operations: ["set"] },
    description: { required: false, schema: { type: "string", system: "description" }, name: "Description", operations: ["set"] },
    priority: { required: false, schema: { type: "priority", system: "priority" }, name: "Priority", operations: ["set"], allowedValues: Object.values(priorities) },
    labels: { required: false, schema: { type: "array", items: "string", system: "labels" }, name: "Labels", autoCompleteUrl: `${BASE}/rest/api/1.0/labels/suggest?query=`, operations: ["add", "set", "remove"] },
    assignee: { required: false, schema: { type: "user", system: "assignee" }, name: "Assignee", autoCompleteUrl: `${BASE}/rest/api/latest/user/assignable/search?issueKey=null&username=`, operations: ["set"] },
    components: { required: false, schema: { type: "array", items: "component", system: "components" }, name: "Component/s", operations: ["add", "set", "remove"], allowedValues: componentsFor(proj) },
    duedate: { required: false, schema: { type: "date", system: "duedate" }, name: "Due Date", operations: ["set"] },
    environment: { required: false, schema: { type: "string", system: "environment" }, name: "Environment", operations: ["set"] },
    fixVersions: { required: false, schema: { type: "array", items: "version", system: "fixVersions" }, name: "Fix Version/s", operations: ["set", "add", "remove"], allowedValues: [{ id: "12000", name: "10.4.0", released: false }] },
    timetracking: { required: false, schema: { type: "timetracking", system: "timetracking" }, name: "Time Tracking", operations: ["set", "edit"] },
    customfield_10016: { required: false, schema: { type: "number", custom: `${CF}float`, customId: 10016 }, name: "Story Points", operations: ["set"] },
    customfield_10100: { required: false, schema: { type: "option", custom: `${CF}select`, customId: 10100 }, name: "Severity", operations: ["set"], allowedValues: CUSTOM_OPTIONS.severity },
    customfield_10101: { required: false, schema: { type: "array", items: "option", custom: `${CF}multicheckboxes`, customId: 10101 }, name: "Platform", operations: ["add", "set", "remove"], allowedValues: CUSTOM_OPTIONS.platform },
    customfield_10102: { required: false, schema: { type: "string", custom: `${CF}textarea`, customId: 10102 }, name: "Steps to Reproduce", operations: ["set"] },
    customfield_10103: { required: false, schema: { type: "datetime", custom: `${CF}datetime`, customId: 10103 }, name: "Target Release Date", operations: ["set"] },
    customfield_10104: { required: false, schema: { type: "user", custom: `${CF}userpicker`, customId: 10104 }, name: "Reviewer", autoCompleteUrl: `${BASE}/rest/api/1.0/users/picker?fieldName=customfield_10104&query=`, operations: ["set"] },
    customfield_10105: { required: false, schema: { type: "option-with-child", custom: `${CF}cascadingselect`, customId: 10105 }, name: "Area", operations: ["set"], allowedValues: CUSTOM_OPTIONS.area },
    customfield_10106: { required: false, schema: { type: "string", custom: `${CF}url`, customId: 10106 }, name: "External Ticket", operations: ["set"] },
    customfield_10107: { required: false, schema: { type: "array", items: "user", custom: `${CF}multiuserpicker`, customId: 10107 }, name: "Stakeholders", operations: ["add", "set", "remove"] },
    customfield_10108: { required: false, schema: { type: "array", items: "json", custom: "com.pyxis.greenhopper.jira:gh-sprint", customId: 10108 }, name: "Sprint", operations: ["set"] },
  };
  if (!forCreate) {
    f.reporter = { required: false, schema: { type: "user", system: "reporter" }, name: "Reporter", operations: ["set"] };
  }
  if (forCreate) {
    f.project = { required: true, schema: { type: "project", system: "project" }, name: "Project", operations: ["set"], allowedValues: [proj] };
    f.issuetype = { required: true, schema: { type: "issuetype", system: "issuetype" }, name: "Issue Type", operations: [], allowedValues: [type] };
    f.reporter = { required: true, schema: { type: "user", system: "reporter" }, name: "Reporter", operations: ["set"] };
    if (type?.subtask) f.parent = { required: true, schema: { type: "issuelink", system: "parent" }, name: "Parent", operations: ["set"] };
  }
  return f;
}

function createMetaFor(proj) {
  return {
    expand: "projects",
    projects: [
      {
        expand: "issuetypes",
        self: proj.self,
        id: proj.id,
        key: proj.key,
        name: proj.name,
        avatarUrls: proj.avatarUrls,
        issuetypes: Object.values(types).map((t) => ({ ...t, expand: "fields", fields: fieldMeta(proj, { forCreate: true, type: t }) })),
      },
    ],
  };
}

// Applies a REST `fields` object (as sent by PUT/POST issue) to an issue.
function applyFields(issue, fields, { creating = false } = {}) {
  const errors = {};
  const proj = issue.fields.project;
  for (const [name, value] of Object.entries(fields ?? {})) {
    switch (name) {
      case "summary":
        if (typeof value !== "string" || !value.trim()) errors.summary = "You must specify a summary of the issue.";
        else issue.fields.summary = value;
        break;
      case "description":
      case "environment":
        issue.fields[name] = value == null ? null : String(value);
        if (name === "description") delete issue.renderedDescription;
        break;
      case "priority": {
        const p = value && Object.values(priorities).find((x) => x.id === String(value.id) || x.name === value.name);
        if (!p) errors.priority = "Priority is not valid.";
        else issue.fields.priority = p;
        break;
      }
      case "labels":
        if (!Array.isArray(value) || value.some((l) => typeof l !== "string" || /\s/.test(l))) errors.labels = "Labels must be an array of strings without spaces.";
        else issue.fields.labels = value;
        break;
      case "assignee":
        if (value == null || value.name === null) issue.fields.assignee = null;
        else if (value.name === "-1") issue.fields.assignee = ME;
        else if (users[value.name]) issue.fields.assignee = users[value.name];
        else errors.assignee = `User '${value.name}' does not exist.`;
        break;
      case "components": {
        const all = componentsFor(proj);
        const picked = (value ?? []).map((c) => all.find((x) => x.id === String(c.id) || x.name === c.name));
        if (picked.some((c) => !c)) errors.components = "Component name is not valid.";
        else issue.fields.components = picked;
        break;
      }
      case "fixVersions":
        issue.fields.fixVersions = (value ?? []).map((v) => ({ id: String(v.id ?? "12000"), name: v.name ?? "10.4.0", released: false }));
        break;
      case "duedate":
        if (value != null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errors.duedate = "Error parsing date string.";
        else issue.fields.duedate = value ?? null;
        break;
      case "reporter":
        if (value == null) errors.reporter = "Reporter is required.";
        else if (value.name === "-1") issue.fields.reporter = ME;
        else if (users[value.name]) issue.fields.reporter = users[value.name];
        else errors.reporter = `User '${value.name}' does not exist.`;
        break;
      case "timetracking":
        issue.fields.timetracking = { ...issue.fields.timetracking, ...(value ?? {}) };
        break;
      case "customfield_10016":
        if (value != null && typeof value !== "number") errors[name] = "Number value expected as 'Story Points'.";
        else issue.fields[name] = value ?? null;
        break;
      case "customfield_10100": {
        const o = value == null ? null : CUSTOM_OPTIONS.severity.find((x) => x.id === String(value.id) || x.value === value.value);
        if (value != null && !o) errors[name] = "Option id 'null' is not valid";
        else issue.fields[name] = o;
        break;
      }
      case "customfield_10101": {
        const picked = (value ?? []).map((v) => CUSTOM_OPTIONS.platform.find((x) => x.id === String(v.id) || x.value === v.value));
        if (picked.some((x) => !x)) errors[name] = "Option id 'null' is not valid";
        else issue.fields[name] = picked;
        break;
      }
      case "customfield_10102":
      case "customfield_10106":
        issue.fields[name] = value == null ? null : String(value);
        break;
      case "customfield_10103":
        if (value != null && Number.isNaN(new Date(String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2")).getTime())) errors[name] = "Error parsing time: " + value;
        else issue.fields[name] = value ?? null;
        break;
      case "customfield_10104":
        if (value == null) issue.fields[name] = null;
        else if (users[value.name]) issue.fields[name] = users[value.name];
        else errors[name] = `User '${value.name}' does not exist.`;
        break;
      case "customfield_10105": {
        if (value == null) {
          issue.fields[name] = null;
          break;
        }
        const parent = CUSTOM_OPTIONS.area.find((x) => x.id === String(value.id));
        const child = parent && value.child ? parent.children.find((c) => c.id === String(value.child.id)) : null;
        if (!parent || (value.child && !child)) errors[name] = "Option id 'null' is not valid";
        else {
          const { children: _c, ...p } = parent;
          issue.fields[name] = child ? { ...p, child } : p;
        }
        break;
      }
      case "customfield_10107": {
        const picked = (value ?? []).map((u) => users[u.name]);
        if (picked.some((u) => !u)) errors[name] = "User does not exist.";
        else issue.fields[name] = picked;
        break;
      }
      case "project":
      case "issuetype":
        if (!creating) errors[name] = `Field '${name}' cannot be set. It is not on the appropriate screen, or unknown.`;
        break;
      default:
        errors[name] = `Field '${name}' cannot be set. It is not on the appropriate screen, or unknown.`;
    }
  }
  return errors;
}

function renderedFields(issue) {
  return {
    description: issue.renderedDescription ?? renderWiki(issue.fields.description),
    environment: renderWiki(issue.fields.environment),
    comment: { comments: issue.fields.comment.comments.map((c) => ({ id: c.id, body: renderWiki(c.body) })) },
    created: issue.fields.created,
    updated: issue.fields.updated,
  };
}

// ---- tiny binary assets ----------------------------------------------------

// 1x1 PNGs / simple SVGs so <img> tags resolve through the asset protocol.
function svgAvatar(seed, text) {
  const hue = (seed * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="24" fill="hsl(${hue} 60% 45%)"/><text x="24" y="31" font-family="sans-serif" font-size="20" fill="#fff" text-anchor="middle">${text}</text></svg>`;
}
function svgIcon(label, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="${color}"/><text x="8" y="12" font-family="sans-serif" font-size="10" font-weight="bold" fill="#fff" text-anchor="middle">${label}</text></svg>`;
}
function svgThumb() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#0052cc"/><stop offset="1" stop-color="#00b8d9"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><text x="320" y="190" font-family="sans-serif" font-size="36" fill="#fff" text-anchor="middle">screenshot.png (mock attachment)</text></svg>`;
}

// ---- server ----------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json;charset=UTF-8", "Content-Length": Buffer.byteLength(data), "X-AREQUESTID": String(Date.now() % 100000) });
  res.end(data);
}
function jiraError(res, code, ...messages) {
  json(res, code, { errorMessages: messages, errors: {} });
}
function svg(res, body) {
  res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=3600" });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function authorized(req) {
  const h = req.headers.authorization ?? "";
  if (h.startsWith("Bearer ")) return h.slice(7).trim() !== "bad";
  if (h.startsWith("Basic ")) {
    const [, pw] = Buffer.from(h.slice(6), "base64").toString().split(":");
    return pw !== "bad";
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const path = url.pathname;
  const t0 = Date.now();
  res.on("finish", () => console.log(`${req.method} ${path}${url.search} -> ${res.statusCode} (${Date.now() - t0}ms)`));

  if (!path.startsWith(CTX + "/")) {
    res.writeHead(302, { Location: `${CTX}/` });
    return res.end();
  }
  const p = path.slice(CTX.length);

  // Static/binary assets: Jira serves these to authenticated sessions; the
  // mock accepts the Authorization header like the REST API does.
  if (p.startsWith("/secure/") || p.startsWith("/images/")) {
    if (!authorized(req)) {
      res.writeHead(401);
      return res.end();
    }
    await sleep(LATENCY / 2);
    if (p.startsWith("/secure/useravatar")) {
      const id = Number(url.searchParams.get("avatarId") ?? 0);
      const u = Object.values(users).find((x) => x.avatarUrls["48x48"].includes(`avatarId=${id}`));
      return svg(res, svgAvatar(id, (u?.displayName ?? "?").split(" ").map((s) => s[0]).join("")));
    }
    if (p.startsWith("/secure/projectavatar")) return svg(res, svgAvatar(Number(url.searchParams.get("avatarId") ?? 1), "P"));
    if (p.startsWith("/secure/viewavatar")) {
      const id = url.searchParams.get("avatarId");
      const map = { 10303: ["B", "#e5493a"], 10315: ["S", "#63ba3c"], 10318: ["T", "#4bade8"], 10316: ["s", "#4bade8"], 10307: ["E", "#904ee2"] };
      const [l, c] = map[id] ?? ["?", "#888"];
      return svg(res, svgIcon(l, c));
    }
    if (p.startsWith("/images/icons/priorities/")) {
      const name = p.split("/").pop().replace(".svg", "");
      const color = { highest: "#cd1317", high: "#e9494a", medium: "#e97f33", low: "#2d8738" }[name] ?? "#888";
      return svg(res, `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M3 ${name === "low" ? 5 : 11} l5 ${name === "low" ? 6 : -6} 5 ${name === "low" ? -6 : 6}" stroke="${color}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
    }
    if (p.startsWith("/secure/thumbnail/") || p.startsWith("/secure/attachment/30001/")) return svg(res, svgThumb());
    if (p.startsWith("/secure/attachment/30003/")) return svg(res, svgAvatar(3, "BB"));
    if (p.startsWith("/secure/attachment/")) {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      return res.end("mock attachment body\n");
    }
    return svg(res, svgIcon("?", "#999"));
  }

  if (p === "/" || p.startsWith("/browse/")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(`<h1>Mock Jira 10.3.2</h1><p>REST at <code>${CTX}/rest/api/2/</code></p>`);
  }

  // Jira's internal wiki renderer, used by the web UI for previews.
  if (p === "/rest/api/1.0/render" && req.method === "POST") {
    if (!authorized(req)) return jiraError(res, 401, "Please log in.");
    const body = await readBody(req);
    await sleep(LATENCY / 2);
    const html = renderWiki(body.unrenderedMarkup ?? "") ?? "";
    res.writeHead(200, { "Content-Type": "text/html;charset=UTF-8" });
    return res.end(html);
  }

  // Jira Software's Agile API (boards).
  if (p.startsWith("/rest/agile/1.0/")) {
    if (!authorized(req)) return jiraError(res, 401, "You do not have permission to access this resource. Please log in.");
    await sleep(LATENCY);
    const a = p.slice("/rest/agile/1.0/".length).replace(/\/$/, "");
    if (a === "board") {
      const startAt = Number(url.searchParams.get("startAt") ?? 0);
      const maxResults = Math.min(Number(url.searchParams.get("maxResults") ?? 50), 50);
      const type = url.searchParams.get("type");
      const all = boards.map((b) => b.summary).filter((b) => !type || b.type === type);
      const page = all.slice(startAt, startAt + maxResults);
      return json(res, 200, { maxResults, startAt, total: all.length, isLast: startAt + page.length >= all.length, values: page });
    }
    const bm = a.match(/^board\/(\d+)(?:\/(.*))?$/);
    if (bm) {
      const board = boards.find((b) => b.summary.id === Number(bm[1]));
      if (!board) return jiraError(res, 404, `No board with id ${bm[1]} exists.`);
      const sub = bm[2] ?? "";
      if (sub === "") return json(res, 200, board.summary);
      if (sub === "configuration") return json(res, 200, board.configuration);
      if (sub === "issue") {
        const startAt = Number(url.searchParams.get("startAt") ?? 0);
        const maxResults = Math.min(Number(url.searchParams.get("maxResults") ?? 50), 200);
        const fields = url.searchParams.get("fields")?.split(",");
        let list;
        try {
          list = runJql(`${board.jql} ${url.searchParams.get("jql") ?? ""}`);
        } catch (e) {
          return jiraError(res, 400, `Error in the JQL Query: ${e.message}`);
        }
        const page = list.slice(startAt, startAt + maxResults).map((i) => ({ expand: "operations,versionedRepresentations,editmeta,changelog,renderedFields", id: i.id, self: i.self, key: i.key, fields: projectIssue(i, fields) }));
        return json(res, 200, { expand: "schema,names", startAt, maxResults, total: list.length, issues: page });
      }
    }
    return jiraError(res, 404, `No such resource: ${p}`);
  }

  if (!p.startsWith("/rest/api/2/")) {
    return jiraError(res, 404, `No such resource: ${p}`);
  }
  const r = p.slice("/rest/api/2/".length).replace(/\/$/, "");

  // serverInfo is anonymous in real Jira too.
  if (r === "serverInfo") {
    return json(res, 200, {
      baseUrl: BASE,
      version: "10.3.2",
      versionNumbers: [10, 3, 2],
      deploymentType: "Server",
      buildNumber: 1003002,
      buildDate: "2025-01-15T00:00:00.000+0000",
      serverTime: new Date().toISOString().replace("Z", "+0000"),
      scmInfo: "mock",
      serverTitle: "Mock Jira",
    });
  }

  if (!authorized(req)) {
    res.setHeader("WWW-Authenticate", 'OAuth realm="mock"');
    return jiraError(res, 401, "You do not have permission to access this resource. Please log in.");
  }

  await sleep(LATENCY);

  try {
    if (r === "myself" && req.method === "GET") return json(res, 200, ME);
    if (r === "filter/favourite") return json(res, 200, filters);
    if (r === "project") return json(res, 200, projects);
    if (r === "priority") return json(res, 200, Object.values(priorities));
    if (r === "issue/createmeta" && req.method === "GET") {
      const keys = (url.searchParams.get("projectKeys") ?? "").split(",").filter(Boolean).map((k) => k.toUpperCase());
      const list = keys.length ? projects.filter((pr) => keys.includes(pr.key)) : projects;
      const expand = (url.searchParams.get("expand") ?? "").includes("projects.issuetypes.fields");
      const metas = list.map((pr) => createMetaFor(pr).projects[0]);
      if (!expand) for (const m of metas) m.issuetypes = m.issuetypes.map(({ fields: _f, ...t }) => t);
      return json(res, 200, { expand: "projects", projects: metas });
    }
    if (r === "issue" && req.method === "POST") {
      const body = await readBody(req);
      const f = body.fields ?? {};
      const proj = projects.find((pr) => pr.key === f.project?.key?.toUpperCase() || pr.id === String(f.project?.id));
      const type = Object.values(types).find((t) => t.id === String(f.issuetype?.id) || t.name === f.issuetype?.name);
      const errors = {};
      if (!proj) errors.project = "project is required";
      if (!type) errors.issuetype = "issue type is required";
      if (!f.summary?.trim()) errors.summary = "You must specify a summary of the issue.";
      if (Object.keys(errors).length) return json(res, 400, { errorMessages: [], errors });
      const { project: _p, issuetype: _t, summary, reporter: _r, parent, ...rest } = f;
      const issue = mkIssue({ proj, type, summary, status: statuses.todo, priority: priorities.medium, assignee: null, reporter: ME, description: null, daysAgo: 0, parent: parent?.key ? linkRef(issues.get(parent.key.toUpperCase())) : undefined });
      issue.fields.created = issue.fields.updated = daysAgoIso(0);
      issue.fields.duedate = null;
      issue.fields.fixVersions = [];
      issue.fields.environment = null;
      issue.fields.timetracking = {};
      const fieldErrors = applyFields(issue, rest, { creating: true });
      if (Object.keys(fieldErrors).length) {
        issues.delete(issue.key);
        projectCounters.set(proj.key, projectCounters.get(proj.key) - 1);
        return json(res, 400, { errorMessages: [], errors: fieldErrors });
      }
      return json(res, 201, { id: issue.id, key: issue.key, self: issue.self });
    }
    if (r === "user/search") {
      const q = (url.searchParams.get("username") ?? "").toLowerCase();
      return json(res, 200, Object.values(users).filter((u) => `${u.name} ${u.displayName} ${u.emailAddress}`.toLowerCase().includes(q)));
    }
    if (r === "search") {
      const body = req.method === "POST" ? await readBody(req) : Object.fromEntries(url.searchParams);
      const startAt = Number(body.startAt ?? 0);
      const maxResults = Math.min(Number(body.maxResults ?? 50), 1000);
      let fields = body.fields;
      if (typeof fields === "string") fields = fields.split(",");
      let list;
      try {
        list = runJql(body.jql);
      } catch (e) {
        return jiraError(res, 400, `Error in the JQL Query: ${e.message}`);
      }
      const page = list.slice(startAt, startAt + maxResults).map((i) => ({ expand: "operations,versionedRepresentations,editmeta,changelog,renderedFields", id: i.id, self: i.self, key: i.key, fields: projectIssue(i, fields) }));
      return json(res, 200, { expand: "schema,names", startAt, maxResults, total: list.length, issues: page });
    }

    const im = r.match(/^issue\/([A-Za-z]+-\d+|\d+)(?:\/(.*))?$/);
    if (im) {
      const issue = issues.get(im[1].toUpperCase()) ?? [...issues.values()].find((i) => i.id === im[1]);
      if (!issue) return jiraError(res, 404, "Issue Does Not Exist");
      const sub = im[2] ?? "";

      if (sub === "" && req.method === "GET") {
        const expand = (url.searchParams.get("expand") ?? "").split(",");
        const out = { expand: "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations", id: issue.id, self: issue.self, key: issue.key, fields: issue.fields };
        if (expand.includes("renderedFields")) out.renderedFields = renderedFields(issue);
        if (expand.includes("transitions")) out.transitions = transitionsFor(issue);
        return json(res, 200, out);
      }
      if (sub === "" && req.method === "PUT") {
        const body = await readBody(req);
        const errors = applyFields(issue, body.fields);
        if (Object.keys(errors).length) return json(res, 400, { errorMessages: [], errors });
        issue.fields.updated = daysAgoIso(0);
        res.writeHead(204);
        return res.end();
      }
      if (sub === "editmeta" && req.method === "GET") return json(res, 200, { fields: fieldMeta(issue.fields.project) });
      if (sub === "comment" && req.method === "POST") {
        const body = await readBody(req);
        if (!body.body?.trim()) return jiraError(res, 400, "Comment body can not be empty!");
        const c = mkComment(ME, body.body, 0);
        issue.fields.comment.comments.push(c);
        issue.fields.comment.total = issue.fields.comment.comments.length;
        issue.fields.updated = daysAgoIso(0);
        return json(res, 201, { ...c, renderedBody: renderWiki(c.body) });
      }
      if (sub === "transitions" && req.method === "GET") return json(res, 200, { expand: "transitions", transitions: transitionsFor(issue) });
      if (sub === "transitions" && req.method === "POST") {
        const body = await readBody(req);
        const t = transitionsFor(issue).find((x) => x.id === String(body.transition?.id));
        if (!t) return jiraError(res, 400, "It seems that you have tried to perform an illegal workflow operation.");
        issue.fields.status = t.to;
        issue.fields.resolution = t.to === statuses.done ? { id: "10000", name: "Done" } : null;
        issue.fields.resolutiondate = t.to === statuses.done ? daysAgoIso(0) : null;
        issue.fields.updated = daysAgoIso(0);
        const add = body.update?.comment?.[0]?.add?.body;
        if (add) issue.fields.comment.comments.push(mkComment(ME, add, 0));
        res.writeHead(204);
        return res.end();
      }
      if (sub === "assignee" && req.method === "PUT") {
        const body = await readBody(req);
        if (body.name === null) issue.fields.assignee = null;
        else if (body.name === "-1") issue.fields.assignee = ME;
        else if (users[body.name]) issue.fields.assignee = users[body.name];
        else return jiraError(res, 400, `User '${body.name}' does not exist.`);
        issue.fields.updated = daysAgoIso(0);
        res.writeHead(204);
        return res.end();
      }
    }
    return jiraError(res, 404, `Unknown resource ${r}`);
  } catch (e) {
    console.error(e);
    return jiraError(res, 500, String(e));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock Jira 10.3.2 listening at ${BASE}  (${issues.size} issues, latency ${LATENCY}ms)`);
  console.log(`connect jirafast to ${BASE} with any PAT (token "bad" -> 401)`);
});
