import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Select,
  Sheet,
  Skeleton,
  StatusState,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tooltip,
} from '@/components/ui'

describe('Kova primitives', () => {
  it('preserves native form semantics and accessible names', () => {
    render(
      <>
        <Button type="submit">Save room</Button>
        <IconButton label="Delete room">×</IconButton>
        <label htmlFor="room-name">Room name</label>
        <Input id="room-name" aria-invalid="true" />
        <label htmlFor="room-type">Room type</label>
        <Select id="room-type" defaultValue="crit">
          <option value="crit">Crit</option>
        </Select>
        <Card aria-label="Room summary">Card</Card>
        <Badge>Published</Badge>
        <Avatar name="Ada Lovelace" />
        <Skeleton data-testid="skeleton" />
        <EmptyState title="No rooms yet" action={<Button>Create room</Button>} />
        <StatusState status="error" title="Could not load" />
      </>
    )

    expect(screen.getByRole('button', { name: 'Save room' })).toHaveAttribute('type', 'submit')
    expect(screen.getByRole('button', { name: 'Delete room' })).toBeInTheDocument()
    expect(screen.getByLabelText('Room name')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Room type')).toHaveValue('crit')
    expect(screen.getByLabelText('Room summary')).toBeInTheDocument()
    expect(screen.getByText('AL')).toBeInTheDocument()
    expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load')
  })

  it('moves and activates tabs with arrow, home, and end keys', async () => {
    const user = userEvent.setup()
    render(
      <Tabs defaultValue="rooms">
        <TabList aria-label="Workspace views">
          <Tab value="rooms">Rooms</Tab>
          <Tab value="people">People</Tab>
          <Tab value="settings">Settings</Tab>
        </TabList>
        <TabPanel value="rooms">Room panel</TabPanel>
        <TabPanel value="people">People panel</TabPanel>
        <TabPanel value="settings">Settings panel</TabPanel>
      </Tabs>
    )

    const rooms = screen.getByRole('tab', { name: 'Rooms' })
    rooms.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'People' })).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('People panel')
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(rooms).toHaveFocus()
  })

  it('opens and navigates a menu from the keyboard', async () => {
    const user = userEvent.setup()
    const rename = vi.fn()
    render(
      <Menu>
        <MenuTrigger>Room actions</MenuTrigger>
        <MenuContent aria-label="Room actions">
          <MenuItem onSelect={rename}>Rename</MenuItem>
          <MenuItem>Delete</MenuItem>
        </MenuContent>
      </Menu>
    )

    const trigger = screen.getByRole('button', { name: 'Room actions' })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    await user.keyboard('{Home}{Enter}')
    expect(rename).toHaveBeenCalledOnce()
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('traps dialog focus, closes on Escape, restores focus, and unlocks scrolling', async () => {
    const user = userEvent.setup()

    function DialogExample() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Open dialog</button>
          <Dialog
            open={open}
            onOpenChange={setOpen}
            title="Delete room?"
            description="This cannot be undone."
          >
            <button>Cancel</button>
            <button>Delete</button>
          </Dialog>
        </>
      )
    }

    render(<DialogExample />)
    const opener = screen.getByRole('button', { name: 'Open dialog' })
    await user.click(opener)
    expect(screen.getByRole('dialog', { name: 'Delete room?' })).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('supports outside dismissal for dialogs and sheets when enabled', async () => {
    const user = userEvent.setup()
    const closeDialog = vi.fn()
    const closeSheet = vi.fn()
    const { rerender } = render(
      <Dialog open onOpenChange={closeDialog} title="Invite people">
        Invite form
      </Dialog>
    )
    await user.click(screen.getByTestId('dialog-backdrop'))
    expect(closeDialog).toHaveBeenCalledWith(false)

    rerender(
      <Sheet open onOpenChange={closeSheet} title="Workspace settings">
        Settings form
      </Sheet>
    )
    expect(screen.getByRole('dialog', { name: 'Workspace settings' })).toHaveAttribute(
      'data-side',
      'right'
    )
    await user.click(screen.getByTestId('sheet-backdrop'))
    expect(closeSheet).toHaveBeenCalledWith(false)
  })

  it('shows a tooltip for keyboard focus and connects it to the trigger', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="Copy invite code">
        <button>Copy</button>
      </Tooltip>
    )

    await user.tab()
    const trigger = screen.getByRole('button', { name: 'Copy' })
    const tooltip = screen.getByRole('tooltip')
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id)
    await user.tab()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('keeps a hovered tooltip open and dismisses it with Escape', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="Open help guidance">
        <button>Help</button>
      </Tooltip>
    )

    const trigger = screen.getByRole('button', { name: 'Help' })
    await user.hover(trigger)
    const tooltip = screen.getByRole('tooltip')
    await user.hover(tooltip)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('dismisses a focused tooltip with Escape without moving trigger focus', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="Open help guidance">
        <button>Help</button>
      </Tooltip>
    )

    await user.tab()
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: 'Help' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('dismisses only the topmost overlay and keeps scrolling locked for the remaining one', async () => {
    const user = userEvent.setup()

    function StackedOverlays() {
      const [dialogOpen, setDialogOpen] = useState(true)
      const [sheetOpen, setSheetOpen] = useState(true)
      return (
        <>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title="Base dialog">
            Base content
          </Dialog>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="Top sheet">
            Top content
          </Sheet>
        </>
      )
    }

    render(<StackedOverlays />)
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    expect(document.body.style.overflow).toBe('hidden')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Top sheet' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Base dialog' })).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps focus in the top overlay when callbacks change or a lower overlay closes', async () => {
    const user = userEvent.setup()

    function ChangingStack() {
      const [baseOpen, setBaseOpen] = useState(false)
      const [sheetOpen, setSheetOpen] = useState(false)
      const [renderCount, setRenderCount] = useState(0)
      return (
        <>
          <button onClick={() => setBaseOpen(true)}>Open base</button>
          <Dialog open={baseOpen} onOpenChange={(next) => setBaseOpen(next)} title="Base dialog">
            <button onClick={() => setSheetOpen(true)}>Open sheet</button>
          </Dialog>
          <Sheet open={sheetOpen} onOpenChange={(next) => setSheetOpen(next)} title="Top sheet">
            <button>First action</button>
            <button>Keep focus here</button>
            <button onClick={() => setRenderCount((count) => count + 1)}>Rerender {renderCount}</button>
            <button onClick={() => setBaseOpen(false)}>Close base</button>
          </Sheet>
        </>
      )
    }

    render(<ChangingStack />)
    const originalTrigger = screen.getByRole('button', { name: 'Open base' })
    await user.click(originalTrigger)
    await user.click(screen.getByRole('button', { name: 'Open sheet' }))
    const focusTarget = screen.getByRole('button', { name: 'Keep focus here' })
    focusTarget.focus()
    fireEvent.click(screen.getByRole('button', { name: 'Rerender 0' }))
    expect(focusTarget).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Close base' }))
    expect(screen.queryByRole('dialog', { name: 'Base dialog' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Top sheet' })).toBeInTheDocument()
    expect(focusTarget).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(originalTrigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })
})
