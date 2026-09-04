# React + Vite

## Development

Install the backend dependencies once with `npm run setup:backend`, then run all
development services with `npm start`. The launcher starts Vite, FastAPI, the QQ
Music API, and the Netease Cloud Music API directly and shuts down the complete
managed process trees when it exits.

Set `PYTHON` to a custom Python executable when `python` is not available on the
system path. The individual `dev`, `backend`, `qqapi`, and `ncmapi` scripts remain
available for debugging one service at a time.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
