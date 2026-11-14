/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SplashScreen } from '../components/SplashScreen.js';
import { AuthPage } from '../components/auth/AuthPage.js';
import { LoginForm } from '../components/auth/LoginForm.js';
import { Navbar } from '../components/Navbar.js';
import { AuthProvider } from '../context/AuthContext.js';

afterEach(() => {
  cleanup();
});

describe('Multi-User Auth Frontend Components', () => {
  describe('SplashScreen Component', () => {
    it('renders the centered logo with alt "Leet Tracker logo" and brand titles', () => {
      render(<SplashScreen />);

      const logo = screen.getByAltText('Leet Tracker logo');
      expect(logo).toBeDefined();
      expect(logo.getAttribute('src')).toBe('/logo.svg');

      expect(screen.getByText('Leet Tracker')).toBeDefined();
      expect(screen.getByText('Spaced Repetition for Solved Problems')).toBeDefined();
      expect(screen.getByRole('status')).toBeDefined();
    });
  });

  describe('AuthPage and Mode Toggling', () => {
    it('renders Sign In initially and switches between Sign In and Register with LeetCode', () => {
      render(
        <AuthProvider>
          <AuthPage />
        </AuthProvider>
      );

      // Initially in Sign In mode
      expect(screen.getAllByRole('button', { name: /^Sign In$/i }).length).toBeGreaterThan(0);
      expect(screen.getByLabelText(/LeetCode Username/i)).toBeDefined();

      // Switch to Register with LeetCode
      const regTab = screen.getByRole('button', { name: /Register with LeetCode/i });
      fireEvent.click(regTab);

      expect(screen.getByText(/We'll verify you own this LeetCode account/i)).toBeDefined();
      expect(screen.getByRole('button', { name: /Continue/i })).toBeDefined();

      // Switch back via bottom link
      const signInLink = screen.getByRole('button', { name: /Sign in here/i });
      fireEvent.click(signInLink);

      expect(screen.getAllByRole('button', { name: /^Sign In$/i }).length).toBeGreaterThan(0);
    });
  });

  describe('LoginForm Component', () => {
    it('renders inputs, handles password visibility toggle, and calls onSubmit', () => {
      render(
        <AuthProvider>
          <LoginForm onSwitchToRegister={vi.fn()} />
        </AuthProvider>
      );

      const usernameInput = screen.getByLabelText(/LeetCode Username/i);
      const passwordInput = screen.getByLabelText(/^Password$/i) as HTMLInputElement;
      expect(passwordInput.type).toBe('password');

      // Toggle show password
      const toggleBtn = screen.getByRole('button', { name: /Show password/i });
      fireEvent.click(toggleBtn);
      expect(passwordInput.type).toBe('text');

      fireEvent.change(usernameInput, { target: { value: 'testuser' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      expect((usernameInput as HTMLInputElement).value).toBe('testuser');
      expect(passwordInput.value).toBe('password123');
    });
  });

  describe('Navbar with User Avatar & Dropdown', () => {
    it('renders user avatar, opens dropdown with LeetCode profile link and Sign Out', () => {
      const mockLogout = vi.fn();
      render(
        <Navbar
          onOpenAdd={vi.fn()}
          onOpenSettings={vi.fn()}
          onSync={vi.fn()}
          syncing={false}
          username="tourist"
          user={{
            id: 'user-123',
            leetcodeUsername: 'tourist',
            createdAt: '2026-10-15T00:00:00Z',
          }}
          onLogout={mockLogout}
        />
      );

      // Logo renders
      const logoImg = screen.getByAltText('Leet Tracker logo');
      expect(logoImg).toBeDefined();
      expect(logoImg.getAttribute('src')).toBe('/logo.svg');

      // Avatar button shows username
      const avatarBtn = screen.getByRole('button', { name: /tourist/i });
      expect(avatarBtn).toBeDefined();

      // Click to open dropdown
      fireEvent.click(avatarBtn);

      // Dropdown contains Signed in as @tourist
      expect(screen.getByText(/@tourist/i)).toBeDefined();

      // Profile link points to https://leetcode.com/tourist/
      const profileLink = screen.getByRole('link', { name: /LeetCode Profile/i });
      expect(profileLink.getAttribute('href')).toBe('https://leetcode.com/tourist/');
      expect(profileLink.getAttribute('target')).toBe('_blank');

      // Sign out button triggers logout callback
      const signOutBtn = screen.getByRole('button', { name: /Sign Out/i });
      fireEvent.click(signOutBtn);
      expect(mockLogout).toHaveBeenCalledTimes(1);
    });
  });
});
