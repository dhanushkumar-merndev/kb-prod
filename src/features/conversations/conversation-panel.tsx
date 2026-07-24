import { loadConversationWorkspaceData } from "./queries";
import { ConversationWorkspace } from "./conversation-workspace";
import styles from "./conversations.module.css";

export async function ConversationPanel() {
  const result = await loadConversationWorkspaceData();

  if (!result.ok) {
    return (
      <div className={styles.error} role="alert">
        <strong>Conversations could not be loaded</strong>
        <p>{result.message}</p>
        <span className={styles.supportCode}>Support code: {result.requestId}</span>
      </div>
    );
  }

  return <ConversationWorkspace data={result.data} />;
}
