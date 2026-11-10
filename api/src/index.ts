import 'dotenv/config';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);

createApp().listen(port, () => {
  console.log(`API escuchando en http://localhost:${port}`);
});
