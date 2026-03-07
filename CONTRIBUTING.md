# Contributing to Idea Basin

Thanks for your interest in contributing!

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Install dependencies:
   ```bash
   npm install
   cd client && npm install
   cd ../server && npm install
   ```
4. Set up PostgreSQL with pgvector:
   ```bash
   createdb idea_basin
   psql idea_basin -c 'CREATE EXTENSION IF NOT EXISTS vector'
   ```
5. Copy `.env.example` to `.env` and configure
6. Copy `server/data/config.example.json` to `server/data/config.json`
7. Start the server: `cd server && npm run dev`
8. Start the client: `cd client && npm run dev`

## Making Changes

1. Create a feature branch: `git checkout -b my-feature`
2. Make your changes
3. Test locally
4. Commit with a clear message
5. Push and open a Pull Request

## Code Style

- ES modules throughout (no CommonJS)
- Express for server routes
- React + Vite for the client
- PostgreSQL queries in `server/db/queries.js`
- API keys are never stored server-side — they're encrypted in browser localStorage

## Reporting Bugs

Open a GitHub issue with:
- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, Node version, PostgreSQL version)

## Security Issues

See [SECURITY.md](SECURITY.md) for responsible disclosure.
