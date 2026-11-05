# Prescription Vault — v1 Spec

## Goal
Simple, good-looking app to store prescriptions and medical reports for yourself and your family.

## Platform & Stack
- iOS + Android from one codebase: **Expo (React Native, TypeScript)**
- Backend: **Supabase** (Postgres + Row Level Security + Storage + Auth), region **ap-south-1 (Mumbai)**
- Encryption: server-side (Supabase at-rest) + TLS. No E2E.

## Auth
- Sign in with Apple + Google only.

## People model
- **User**: has an account and owns their own documents.
- **Managed profile**: created by a user for someone without the app (child, elderly parent). The creator has full control. The person can claim it later via an invite link, which turns it into their own account and keeps the creator's view access.
- **Family link**: A requests access to B's documents → B approves → A gets **view-only** access. B can revoke at any time. One-directional (B must request separately to see A's).

## Invite flow
1. A taps "Add family" → app creates a one-time invite link (expires after 7 days).
2. A shares it (WhatsApp, etc.).
3. B opens it → installs the app or deep-links in → signs in → sees "A wants to view your records" → Approve / Decline.

## Documents
- Sources: camera scan (native document scanner, auto-crop), photo library, PDF import (share sheet + file picker).
- Fields: `type` (Prescription | Report), `date` (default today), `title` (optional), `doctor`, `specialty`, `hospital` (optional), pages (1..n).
- View: timeline for each person, newest first, filter by type, search over title / doctor / specialty (incl. everyday words like "skin" → Dermatology) / hospital / type / date.
- Offline: recently viewed files cached on device, encrypted (expo-secure-store key + encrypted file cache).

## Data model (sketch)
```
profiles(id, owner_user_id null, display_name, avatar, is_managed, created_by)
documents(id, profile_id, type, doc_date, title, created_by, created_at)
document_pages(id, document_id, storage_path, mime, page_no)
access_grants(id, viewer_user_id, profile_id, status[pending|active|revoked], created_at)
invites(id, token, from_user_id, purpose[link|claim], profile_id null, expires_at, used_at)
```
RLS: a row is visible if you own the profile, created the managed profile, or hold an active grant (read-only).
Storage bucket policy mirrors the RLS rules.

## Design
- Minimal monochrome, native iOS feel (black/white, SF-style type, system grouped lists).
- Large tap targets and readable type for elderly users. Dynamic Type supported.
- Screens: Home (family avatars row + recent docs) → Person timeline → Document viewer → Add (Scan / Photo / PDF) → Family (members, pending requests, invite).

## Compliance (India, DPDP Act 2023)
- Explicit consent screen at signup and on every approval.
- Account and data deletion inside the app (also required by Apple).
- Privacy policy URL; data stored in an India region.
- App Store: health data privacy labels; no HealthKit in v1.

## Out of scope for v1
OCR / AI auto-fill of details, tags, sharing to doctors, reminders, payments, E2E.
