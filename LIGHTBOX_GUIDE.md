# Full-Screen Lightbox Image Viewer Guide

## 🎯 New Lightbox Experience

Clicking a board in view mode now opens a professional full-screen lightbox with integrated comments!

---

## 📐 Layout Structure

```
┌────────────────────────────────────────────────────────────────┐
│ Board Title                    [← Previous] [Next →]      [X] │ ← Top bar
├────────────────────────────────────────────────────────────────┤
│                                    │                           │
│                                    │  💬 Comments (3)          │
│                                    ├───────────────────────────┤
│          [FULL-SIZE IMAGE]         │  [L] Linna    2h ago     │
│                                    │      Great work!          │
│              (60-70%)              │                           │
│                                    │  [TU] Test User  1h ago  │ ← Comments
│                                    │      Love this!           │ (scrollable)
│                                    │                           │
│                                    │  ┌─────────────────────┐ │
│                                    │  │ Add comment...      │ │
│                                    │  │           [Post]    │ │ ← Form
│                                    │  └─────────────────────┘ │
└────────────────────────────────────┴───────────────────────────┘
                [Press ESC to close • ← → to navigate]
```

---

## 🎨 Visual Design

### **Backdrop:**
- Color: `rgba(0, 0, 0, 0.85)` (85% black)
- No blur (keeps image sharp)
- Click to close

### **Top Header Bar:**
- Background: `black/40` + `backdrop-blur-sm`
- Border: `white/10` bottom border
- Height: 64px (h-16)
- Content:
  - **Left:** Board title + student name
  - **Center:** Previous/Next buttons
  - **Right:** Close button (X)

### **Image Area (Left 60-70%):**
- Background: Transparent (shows dark backdrop)
- Padding: Large (p-8 to p-12)
- Image:
  - `max-w-full max-h-full` (fills available space)
  - `object-contain` (maintains aspect ratio)
  - Rounded corners + shadow
  - Centered vertically and horizontally

### **Comment Panel (Right 30-40%):**
- Background: White (solid)
- Width: 400px on lg, 480px on xl
- Shadow: `shadow-2xl`
- Sections:
  - Header (title + count badge)
  - Comments list (scrollable)
  - Add form (sticky at bottom)

---

## 🎬 Animations & Interactions

### **Open Animation:**
```css
Fade in: 0 → 100% opacity (300ms)
```

### **Close Animation:**
```css
Fade out: 100% → 0% opacity (200ms)
```

### **Keyboard Shortcuts:**
- `ESC` - Close lightbox
- `←` (Left Arrow) - Previous board
- `→` (Right Arrow) - Next board
- `Cmd/Ctrl + Enter` - Post comment (in textarea)

### **Mouse Interactions:**
- Click backdrop (dark area) - Close
- Click X button - Close
- Click Previous/Next - Navigate boards
- Click in comment panel - Does NOT close

---

## 🔄 Navigation Logic

### **Board Order:**
All boards in the studio (from API response)

### **Current Board:**
The board that was clicked

### **Previous Button:**
- Enabled if not first board
- Disabled (grayed out) if first board
- Click → Shows previous board in array

### **Next Button:**
- Enabled if not last board
- Disabled (grayed out) if last board
- Click → Shows next board in array

### **Arrow Keys:**
- Left arrow → Previous (if enabled)
- Right arrow → Next (if enabled)

---

## 🧪 Testing

### **Test 1: Open Lightbox**

1. Go to view mode: `/studio/studio-a/view`
2. Click any board
3. **Expected:**
   - ✅ Screen darkens (85% black)
   - ✅ Lightbox fades in smoothly
   - ✅ Image appears large and centered
   - ✅ Comment panel on right
   - ✅ Top bar shows board title

---

### **Test 2: Image Display**

**Portrait image:**
- ✅ Image height fills available space
- ✅ Maintains aspect ratio
- ✅ Centered horizontally

**Landscape image:**
- ✅ Image width fills available space
- ✅ Maintains aspect ratio
- ✅ Centered vertically

**Very large image:**
- ✅ Scales down to fit
- ✅ Never exceeds viewport
- ✅ Still readable

---

### **Test 3: Navigation**

**Setup:** Open lightbox on first board

1. **Check Previous button:**
   - ✅ Disabled (grayed out)
   - ✅ Click does nothing

2. **Click Next button:**
   - ✅ Image changes to next board
   - ✅ Comments reload for new board
   - ✅ Title updates
   - ✅ Smooth transition

3. **Press → (Right Arrow):**
   - ✅ Same as clicking Next

4. **Navigate to last board:**
   - ✅ Next button becomes disabled
   - ✅ Previous button enabled

---

### **Test 4: Comments**

1. Open lightbox
2. **Verify comment panel:**
   - ✅ Shows board title "💬 Comments"
   - ✅ Count badge if comments exist
   - ✅ Scrollable list
   - ✅ Avatar circles with colors

3. **Add new comment:**
   - Type: "Amazing perspective!"
   - Click "Post Comment"
   - **Expected:**
     - ✅ Button shows "Posting..."
     - ✅ Comment appears in list
     - ✅ Author is "Linna"
     - ✅ Timestamp is "Just now"
     - ✅ Textarea clears
     - ✅ Sticky note count increases by 1

---

### **Test 5: Close Lightbox**

**Method 1: Click X**
1. Click X in top-right
   - ✅ Lightbox fades out
   - ✅ Returns to 3D view

**Method 2: Press ESC**
1. Press ESC key
   - ✅ Lightbox closes immediately

**Method 3: Click backdrop**
1. Click dark area outside image/panel
   - ✅ Lightbox closes

**Method 4: Click image**
- ❌ Does NOT close (prevents accidental closes)

---

### **Test 6: Many Comments**

Add 20+ comments to test scrolling:

```powershell
$BOARD_ID = "board-XXX"
1..25 | ForEach-Object {
    $body = @{ text = "Comment $_"; author = "Linna" } | ConvertTo-Json
    Invoke-RestMethod -Uri "http://localhost:3000/api/boards/$BOARD_ID/comments" -Method Post -Body $body -ContentType "application/json"
}
```

**Verify:**
- ✅ Comment panel scrolls smoothly
- ✅ Form stays at bottom (sticky)
- ✅ Can scroll while form is visible
- ✅ All 25 comments accessible

---

### **Test 7: Keyboard Navigation**

1. Open lightbox on any board
2. **Press → (Right Arrow)** repeatedly
3. **Expected:**
   - ✅ Cycles through all boards
   - ✅ Images change smoothly
   - ✅ Comments reload for each
   - ✅ Stops at last board

4. **Press ← (Left Arrow)** to go back
5. **Expected:**
   - ✅ Cycles backwards
   - ✅ Same smooth experience

---

## 🎨 Design Details

### **Color Scheme:**

**Dark Area (Image Background):**
- Backdrop: `rgba(0, 0, 0, 0.85)`
- Focus on image
- Minimal distractions

**Light Area (Comment Panel):**
- Background: White (solid)
- Clean, readable
- Clear separation from image

**Top Bar:**
- Background: `black/40` + blur
- Border: `white/10`
- Semi-transparent, stays out of the way

### **Typography:**

**Lightbox:**
| Element | Style |
|---------|-------|
| Board title | text-lg, font-semibold, white |
| Student name | text-sm, gray-400 |
| Nav buttons | text-sm, white |

**Comment Panel:**
| Element | Style |
|---------|-------|
| Panel title | text-xl, font-bold, gray-900 |
| Author | text-sm, font-bold, gray-900 |
| Comment | text-sm, gray-700, relaxed |
| Timestamp | text-xs, gray-500 |

---

## 🎯 User Experience

### **Why Full-Screen Lightbox?**

**Advantages:**
1. **Image Focus** - Large, detailed view
2. **Context** - Can see image while reading comments
3. **Efficient** - View + comment in one interface
4. **Familiar** - Pattern used by Behance, Dribbble, Instagram
5. **Keyboard Nav** - Quick board-to-board browsing

**vs Side Panel:**
- Side panel good for quick comments
- Lightbox better for detailed critique
- Image quality matters in architecture crits

---

## 📱 Responsive Behavior

### **Desktop (lg+):**
```
[    Image (70%)    ] [ Comments (30%) ]
```

### **Tablet (md):**
```
[    Image (60%)    ] [ Comments (40%) ]
```

### **Mobile (sm) - Future:**
```
┌────────────────┐
│     Image      │
│   (full width) │
├────────────────┤
│   Comments     │
│  (scrollable)  │
└────────────────┘
```

---

## 🔧 Technical Implementation

### **State Management:**

```typescript
// View page
const [selectedBoard, setSelectedBoard] = useState<Board | null>(null)

// Open lightbox
const handleBoardClick = (board: Board) => {
  setSelectedBoard(board)
}

// Navigate
const handleNavigate = (direction: 'prev' | 'next') => {
  const currentIndex = boards.findIndex(b => b.id === selectedBoard.id)
  const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1
  if (newIndex >= 0 && newIndex < boards.length) {
    setSelectedBoard(boards[newIndex])
  }
}

// Render
<LightboxModal 
  board={selectedBoard}
  allBoards={boards}
  onClose={() => setSelectedBoard(null)}
  onNavigate={handleNavigate}
/>
```

### **Comment Fetching:**

Fetches fresh comments each time board changes:

```typescript
useEffect(() => {
  if (!board) return
  fetchComments()
}, [board?.id])
```

---

## 🎬 Animation Flow

```
Click board
  ↓
selectedBoard set
  ↓
Lightbox renders
  ↓
isVisible = false initially
  ↓
After 10ms: isVisible = true
  ↓
CSS transition: opacity 0 → 1 (300ms)
  ↓
Lightbox visible!
  ↓
Comments fetch in background
  ↓
Comments appear
  ↓
User clicks X or ESC
  ↓
isVisible = false
  ↓
CSS transition: opacity 1 → 0 (200ms)
  ↓
After 200ms: onClose() called
  ↓
selectedBoard = null
  ↓
Lightbox unmounts
```

---

## 🐛 Troubleshooting

### **Image doesn't show:**
- Check `board.fullImageUrl` exists
- Verify image URL is accessible
- Check console for CORS errors
- Fallback shows 🖼️ emoji

### **Can't navigate:**
- Check `allBoards` array has multiple boards
- Verify currentIndex calculation
- Check console for navigation logs

### **Comments don't load:**
- Check API endpoint works
- Verify board.id is correct
- Check network tab for request

### **Textarea doesn't focus:**
- Check ref is attached
- Verify textareaRef.current exists
- Try clicking in textarea manually

---

## 🎯 Success Checklist

- [ ] Click board → lightbox opens
- [ ] Image displays full-size
- [ ] Top bar shows title
- [ ] Previous/Next buttons work
- [ ] Comments load in right panel
- [ ] Can scroll comments
- [ ] Can add new comment
- [ ] Author is "Linna"
- [ ] Close on ESC works
- [ ] Close on backdrop works
- [ ] Arrow key navigation works
- [ ] Smooth animations throughout

---

## 🚀 Next Steps (Future)

### **Image Features:**
- [ ] Zoom in/out on image
- [ ] Pan large images
- [ ] Fullscreen image mode
- [ ] Download original

### **Comment Features:**
- [ ] Pin comments to image coordinates
- [ ] Visual markers on image
- [ ] Reply threads
- [ ] @ mentions

### **Navigation:**
- [ ] Thumbnail strip at bottom
- [ ] Filter boards by tags
- [ ] Jump to specific board
- [ ] Slideshow mode

---

## Summary

✅ **Lightbox complete!**
- Full-screen professional viewer
- Large image display (60-70% width)
- Integrated comment panel (30-40% width)
- Keyboard navigation (arrows + ESC)
- Add comments as "Linna"
- Smooth animations
- Modern, clean design

🎉 **Result:** Professional architecture critique interface perfect for detailed image viewing and feedback!

