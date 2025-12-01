Cloudinary Integration Setup
================================

This project now includes a Cloudinary integration that allows the backend to upload user avatars and other images.

Environment Variables (set these in your .env or CI environment):
- CLOUDINARY_CLOUD_NAME
- CLOUDINARY_API_KEY
- CLOUDINARY_API_SECRET

Install runtime dependency for Cloudinary:

```bash
npm install cloudinary
```

Also install multer (often required in NestJS for multipart):

```bash
npm install multer
```

Notes:
- The `AccountController` accepts multipart file uploads at `PUT /api/users/profile` with the field name `avatar`.
- The frontend already sends a base64 dataURL in `avatarUrl` for profile updates; the backend handles base64, converts it to a Cloudinary-hosted URL, and stores the returned secure url in `Profile.avatarUrl`.
- If the frontend sends a multipart file (`avatar`), the controller will upload it to Cloudinary using memory storage.
