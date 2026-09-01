/**
 * React Native Web passes a `hovered` flag to Pressable's style callback, but
 * the React Native types do not declare it. This is the narrow, honest way to
 * use it without casting at every call site.
 */
export interface PressState {
  readonly pressed: boolean;
  readonly hovered?: boolean;
  readonly focused?: boolean;
}
