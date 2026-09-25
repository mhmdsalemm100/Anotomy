import type { App, Route, View } from '../app/app';
export class MicroView implements View {
  static async create(app: App, _r: Route) { app.ui.textContent = 'Micro explorer coming soon'; return new MicroView(); }
  destroy() {}
}
