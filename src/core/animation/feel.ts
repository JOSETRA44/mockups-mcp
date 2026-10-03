/**
 * The product's motion "signature". Every preset that uses the `product` or `spring`
 * ease goes through these constants, so tuning them changes the feel of the whole app.
 */

/** cubic-bezier(x1, y1, x2, y2) used by the `product` ease. */
export const PRODUCT_BEZIER: [number, number, number, number] = [0.16, 1, 0.3, 1]

/**
 * Normalised spring: u ∈ [0,1] → progress, settling at 1 by u = 1.
 * `damping` is the damping ratio ζ (0 < ζ < 1 = some overshoot); `settle` is how many
 * e-folds of decay happen across the clip (higher = settles earlier).
 */
export const SPRING = { damping: 0.62, settle: 6.5 }
