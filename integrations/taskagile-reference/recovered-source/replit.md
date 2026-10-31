# No_Gas_Slaps™ - Telegram Mini App

## Overview

No_Gas_Slaps™ is a production-ready, tap-to-earn gaming Telegram Mini App built with a modular JavaScript architecture. The game features a fast-paced slapping mechanic with combo multipliers, power-ups, leaderboards, and comprehensive anti-cheat systems. The application is designed as a mobile-first Progressive Web App (PWA) with full Telegram integration, accessibility compliance, and offline-first capabilities.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
The frontend uses a **modular ES6+ JavaScript architecture** with no frameworks, emphasizing performance and compatibility. Key architectural decisions include:

- **Module-based organization**: Each feature (UI, state management, audio, animations) is isolated in separate ES modules for maintainability
- **Event-driven architecture**: Components communicate through event listeners and callbacks rather than direct coupling
- **Mobile-first responsive design**: CSS custom properties enable seamless theming and responsive layouts
- **Accessibility-first approach**: WCAG 2.1 AA compliance with comprehensive ARIA support and keyboard navigation

### Game State Management
The state management system implements a **centralized state pattern** with the following characteristics:

- **Anti-cheat mechanisms**: Rate limiting (max 4 taps/second), suspicious activity detection, and score validation
- **Offline-first persistence**: Uses localStorage with a sync queue for reliable data storage
- **Real-time validation**: Input throttling and combo system with time-based multipliers
- **Power-up system**: Time-based abilities with cooldowns and unlock thresholds

### Data Architecture
The application uses a **hybrid persistence model**:

- **Primary storage**: Neon PostgreSQL database with Drizzle ORM for production data
- **Local caching**: Browser localStorage for offline gameplay and performance
- **Sync queue system**: Queues operations when offline and syncs when connection is restored
- **Leaderboard caching**: 5-minute cache duration with manual refresh capability

### Audio & Animation Systems
**Hardware-accelerated performance** is achieved through:

- **Web Audio API**: For low-latency sound effects and background music
- **CSS transforms and transitions**: GPU-accelerated animations with reduced-motion support
- **Particle system**: Canvas-based visual effects for enhanced user feedback
- **RequestAnimationFrame loops**: Smooth 60fps animations and game updates

### Authentication & Security
Security is implemented through multiple layers:

- **Telegram WebApp SDK integration**: Native authentication through Telegram's secure init data
- **HMAC validation**: Cryptographic verification of user data and requests
- **Input sanitization**: XSS prevention and injection attack mitigation
- **Rate limiting**: Client-side throttling with server-side validation planned

## External Dependencies

### Core Infrastructure
- **Neon PostgreSQL**: Primary database for user data, scores, and leaderboards
- **Drizzle ORM**: Type-safe database operations with PostgreSQL dialect
- **Vite**: Development server and build tool with React and TypeScript support
- **Express.js**: Backend API server for game data and leaderboard management

### Telegram Integration
- **Telegram Web App SDK**: Official SDK for Mini App functionality, theming, and user authentication
- **Telegram Bot API**: For sharing features and user notifications (placeholder implementation)

### UI & Styling Framework
- **Radix UI Components**: Accessible, unstyled component primitives for complex UI elements
- **Tailwind CSS**: Utility-first CSS framework for responsive design
- **Three.js & React Three Fiber**: 3D graphics and animations (React components only)
- **PostCSS & Autoprefixer**: CSS processing and vendor prefix automation

### Audio & Media
- **Web Audio API**: Native browser audio processing for sound effects
- **GLSL Shaders**: Custom visual effects and particle systems
- **Canvas API**: 2D graphics rendering for game elements

### Development & Testing
- **TypeScript**: Type safety across the entire codebase
- **ESLint**: Code quality and consistency enforcement
- **React Query**: Server state management for the React components
- **Embla Carousel**: Touch-friendly carousel components for UI

### Monetization Integrations (Placeholder)
- **Wallet connection stubs**: Prepared for gasless Web3 wallet integration
- **Ad network placeholders**: Ready for rewarded video ad implementation
- **In-app purchase hooks**: Structured for future monetization features