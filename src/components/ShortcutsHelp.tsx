import { Fragment } from "react";
import css from "./ShortcutsHelp.module.css";

const rows: Array<[string, string]> = [
  ["j / ↓", "Next issue"],
  ["k / ↑", "Previous issue"],
  ["f", "Toggle focus mode (issue fills the window)"],
  ["F11", "Toggle OS fullscreen"],
  ["/", "Search (text, issue key or JQL)"],
  ["c", "Add a comment"],
  ["e", "Edit the issue (fullscreen description editor)"],
  ["n", "New issue"],
  ["Ctrl S", "Editor: save"],
  ["Ctrl Shift F", "Editor: show / hide the fields sidebar"],
  ["Ctrl P", "Editor: switch rich text / markup"],
  ["r", "Refresh list and issue"],
  ["u", "Back to the previous issue"],
  ["b", "Toggle sidebar"],
  ["Esc", "Leave focus mode / blur input / close viewer"],
  ["Ctrl + / Ctrl −", "Zoom text"],
  ["?", "This help"],
];

export default function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className={css.backdrop} onClick={onClose}>
      <div className={css.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts" tabIndex={-1}>
        <h2>Keyboard shortcuts</h2>
        <table>
          <tbody>
            {rows.map(([keys, what]) => (
              <tr key={keys}>
                <td className={css.keys}>
                  {keys.split(" / ").map((k, i) => (
                    <Fragment key={k}>
                      {i > 0 && <span className={css.or}> / </span>}
                      <kbd>{k}</kbd>
                    </Fragment>
                  ))}
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
