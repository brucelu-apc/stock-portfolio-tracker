# Project Constitution - Stock Portfolio Tracker

## Core Principles
- **Spec-Driven**: All features must start with a specification and plan in the `.specify` directory.
- **Serverless Architecture**: Use React + Chakra UI on the frontend, and Supabase for Authentication, Database, and API.
- **Security First**: Implement Row Level Security (RLS) in Supabase to ensure users only access their own data.
- **Mobile First**: UI must be fully responsive (RWD) using Chakra UI's responsive props.
- **Automated Deployment**: Master branch deployments are handled via Vercel integration or GitHub Actions.
- **Data Integrity**: Stock prices and exchange rates are updated via scheduled GitHub Actions.

## Technical Standards
- **Framework**: React + Vite.
- **Language**: TypeScript (preferred for type safety).
- **Styling**: Chakra UI (Standard component library).
- **State Management**: React Context or lightweight library (Zustand).
- **Code Quality**: Prettier and ESLint are mandatory.
