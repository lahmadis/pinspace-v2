/**
 * Utility functions for calculating board sizes based on physical dimensions
 */

import { Board, WallDimensions } from '@/types'

/**
 * Calculate board size as percentages of wall dimensions based on physical size in inches
 * @param board - The board with physical dimensions
 * @param wallDimensions - The wall dimensions in feet
 * @returns Object with width and height as percentages (0-1)
 */
export function calculateBoardSizeFromPhysicalDimensions(
  board: Board,
  wallDimensions: WallDimensions
): { width: number; height: number } {
  // If board has physical dimensions, use them to calculate size
  if (board.physicalWidth && board.physicalHeight) {
    // Convert wall dimensions from feet to inches
    const wallWidthInches = wallDimensions.width * 12 // 8 ft = 96 inches
    const wallHeightInches = wallDimensions.height * 12 // 10 ft = 120 inches
    
    // Calculate what percentage of the wall the board occupies
    const widthPercent = board.physicalWidth / wallWidthInches
    const heightPercent = board.physicalHeight / wallHeightInches
    
    // Clamp to ensure board doesn't exceed wall size
    const clampedWidth = Math.min(widthPercent, 1.0)
    const clampedHeight = Math.min(heightPercent, 1.0)
    
    return {
      width: clampedWidth,
      height: clampedHeight
    }
  }
  
  // Fallback: if no physical dimensions, return undefined to use existing logic
  return { width: 0, height: 0 }
}




