export const isBlank = (strElement: string | null | undefined): boolean => {
    return typeof strElement !== "string" || strElement.trim() === "";
}