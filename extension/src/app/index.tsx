// Extension "All comments" page (app.html): the same screens as the web app, using the extension host.
import '@pinpoint/ui/styles.css';
import { render } from 'preact';
import { AppRoutes, AppShell, Skeleton, UiProvider, useHashRoute, useUi } from '@pinpoint/ui';
import { ExtensionHost } from './extHost';
import { SignIn } from './SignIn';

function App({ host }: { host: ExtensionHost }) {
  const route = useHashRoute();
  const { session } = useUi();
  if (!host.state.signedIn || !session.me) return <SignIn host={host} />;
  return (
    <AppShell route={route}>
      <AppRoutes route={route} />
    </AppShell>
  );
}

async function main() {
  const root = document.getElementById('app')!;
  render(<Skeleton rows={6} />, root);
  try {
    const host = await ExtensionHost.create();
    render(
      <UiProvider host={host}>
        <App host={host} />
      </UiProvider>,
      root,
    );
  } catch (e) {
    root.textContent = `Pinpoint could not start: ${e instanceof Error ? e.message : String(e)}`;
  }
}

main();
