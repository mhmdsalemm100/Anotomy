import './styles/app.css';
import { App } from './app/app';
import { Explorer, restoreSettings } from './app/explorer';
import { Landing } from './app/landing';

const root = document.getElementById('app')!;
const app = new App(root);
restoreSettings();
app.views.landing = (a) => Landing.create(a);
app.views.body = (a, r) => Explorer.create(a, r as any);
app.views.micro = async (a, r) => {
  const { MicroView } = await import('./micro/MicroView');
  return MicroView.create(a, r as any);
};
app.start().catch((e) => {
  console.error(e);
  (window as any).__error = String(e);
});
(window as any).__app = app;
