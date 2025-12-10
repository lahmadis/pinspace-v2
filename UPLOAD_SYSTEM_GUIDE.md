# Upload System Guide 🎨

## What We Just Built

A complete upload system that lets students add their own boards to the 3D studio rooms!

## How It Works

### For Students:

1. **Go to Upload Page**
   - From landing page: Click "Upload Your Board" button
   - From explore view: Click "Upload Board" button in header
   - Or visit: `localhost:3000/upload`

2. **Fill Out the Form**
   - Upload image (PNG, JPG, or PDF)
   - Enter your name
   - Add project title
   - Optional: description, email, tags
   - Select which studio

3. **Submit**
   - Click "Upload Board"
   - Board is saved locally
   - You're redirected to explore view

4. **View in 3D**
   - Navigate to the studio you selected
   - Your board appears on the walls with the others!
   - Your actual image shows as the texture

### Where Files Are Stored:

- **Images**: `public/uploads/` folder
- **Metadata**: `lib/data/boards.json` file

### Technical Details:

**Upload Flow:**
```
Student fills form
    ↓
Image uploaded to /api/upload
    ↓
Image saved to public/uploads/
    ↓
Metadata saved to boards.json
    ↓
Board appears in 3D room
```

**Image Loading:**
- 3D room loads both sample boards AND uploaded boards
- BoardThumbnail component uses TextureLoader for images
- Fallback to colored rectangles if image fails to load

## Testing the Upload System

### Try It Now:

1. **Start the server** (if not running):
   ```bash
   npm run dev
   ```

2. **Go to upload page**:
   - Visit http://localhost:3000/upload

3. **Upload a test image**:
   - Use any PNG/JPG image from your computer
   - Architecture board? Even better!
   - Fill in:
     - Name: "Test Student"
     - Title: "My First Board"
     - Studio: "Urban Interventions"
   - Click Upload

4. **Check it worked**:
   - You should be redirected to /explore
   - Navigate: WIT → Year 3 Fall → Urban Interventions
   - Your board should appear on the walls!
   - It should show your actual image as the texture

5. **Verify files**:
   - Check `public/uploads/` - your image is there
   - Check `lib/data/boards.json` - your metadata is there

## What's Cool About This

### Real Image Textures:
- Uploaded images appear as actual textures on 3D boards
- Not just placeholders anymore!
- Looks way more professional

### Instant Persistence:
- Upload once, appears immediately
- Survives server restarts
- No database needed (for now)

### Studio Organization:
- Boards automatically organized by studio
- Multiple students can upload to same studio
- All boards appear together on the walls

## Current Limitations

### Local Storage:
- Images stored in `public/uploads/`
- Fine for prototype/demo
- For production, need cloud storage (Cloudinary, Vercel Blob)

### No Authentication:
- Anyone can upload
- Can't edit/delete boards (yet)
- For demo purposes, this is fine

### No Validation:
- File size not strictly limited
- Could add more error handling
- Would need spam prevention for production

## Next Steps to Add:

### Phase 2 (Later):
1. **Cloud Storage**
   - Move images to Cloudinary or Vercel Blob
   - Better for production
   - Handles resizing/optimization

2. **User Authentication**
   - Students login
   - Can only edit their own boards
   - Faculty has admin access

3. **Board Management**
   - Edit board info
   - Delete boards
   - Reorder on walls

4. **Better Validation**
   - File size limits
   - Image format checking
   - Duplicate detection

## Demo Tips

### Show Your Professor:

1. **Upload a board** live during demo
   - Have an image ready
   - Fill form quickly
   - Show it appears instantly

2. **Navigate to 3D room**
   - Point out the new board on the wall
   - It has the real image!
   - Click to see detail page

3. **Key point**:
   "Students can upload their work themselves, and it automatically appears in the 3D critique space"

### If He Asks:

**"Where are the images stored?"**
→ Currently local for demo. Easy to migrate to cloud storage (Cloudinary, Vercel) for production.

**"Can students edit their boards?"**
→ Not yet, but that's a quick add with authentication.

**"How do you prevent spam/abuse?"**
→ Would add authentication and faculty approval for production.

**"Does it handle PDFs?"**
→ Upload accepts PDFs but displays as images. Could add PDF → image conversion.

## Success!

You now have a **complete end-to-end upload system**:
- ✅ Upload form
- ✅ File storage
- ✅ Metadata persistence
- ✅ 3D room integration
- ✅ Real image textures

Students can actually use this to share their work! 🎉
