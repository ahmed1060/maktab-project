/**
 * The building blocks (DESIGN.md §5). Pages compose these and don't re-style
 * them; their look is in ./ui.css, from the tokens in app/globals.css.
 */
export { Icon, type PhosphorIcon } from './Icon'
export { Button, ButtonLink, type ButtonVariant } from './Button'
export { Field, TextInput, TextArea, SearchInput, Select, Choice, type FieldControlProps, type SelectOption } from './Field'
export { ColourChoice } from './ColourChoice'
export { Dialog, DialogActions } from './Dialog'
export { FilterBar } from './FilterBar'
export { DataList, ItemTitle, DueDate, ListCard, visibleRow, type Column, type RowTone } from './DataList'
export { Pager, pageInRange, pageWindow } from './Pager'
export { Tabs, TabLinks, type TabItem } from './Tabs'
export { StatusBadge, taskStatusTone, TASK_STATUS_TONE, type StatusTone } from './StatusBadge'
export { Avatar, Person, initials } from './Avatar'
export { PageHeader, Page, Columns, Section, SectionLink, Rows, Row, Panel, Card, Details, SelectionBar, TotalTiles, DonutChart, donutArcs, EmptyState, type Tile, type DonutPart } from './Blocks'
export { FileChip, FileChips, FilePicker } from './Files'
export { ExpiryDate, ExpiryBadge } from './Expiry'
export { RowMenu, type MenuItem } from './Menu'
export { NamePicker, type PickedName, type ListedName } from './NamePicker'
