/**
 * Memory Store for María Agent
 * 
 * Provides persistent storage for:
 * - Conversation history
 * - User preferences
 * - Session data
 * 
 * Uses file-based storage with path validation.
 */

import * as fs from 'fs'
import * as path from 'path'

export class MemoryStore {
  private basePath: string

  constructor(basePath: string) {
    this.basePath = path.resolve(basePath)
    this.ensureDirectory()
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true })
    }
  }

  /**
   * Validate path to prevent directory traversal attacks
   */
  private validatePath(inputPath: string): string {
    const normalized = path.normalize(inputPath).replace(/^\.[\/\\]+/, '')
    const fullPath = path.resolve(this.basePath, normalized)
    
    if (!fullPath.startsWith(this.basePath)) {
      throw new Error('Path traversal attempt detected')
    }
    return fullPath
  }

  /**
   * View file contents or directory listing
   */
  async view(inputPath: string, viewRange?: [number, number]): Promise<string> {
    const fullPath = this.validatePath(inputPath)
    
    try {
      const stats = fs.statSync(fullPath)
      
      if (stats.isDirectory()) {
        const entries = fs.readdirSync(fullPath)
        return `Directory: ${inputPath}\n${entries.map(e => `- ${e}`).join('\n')}`
      }
      
      let content = fs.readFileSync(fullPath, 'utf-8')
      
      if (viewRange) {
        const lines = content.split('\n')
        const [start, end] = viewRange
        content = lines.slice(
          Math.max(0, start - 1),
          end === -1 ? lines.length : end
        ).join('\n')
      }
      
      return content
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return `File not found: ${inputPath}`
      }
      throw error
    }
  }

  /**
   * Create or overwrite a file
   */
  async create(inputPath: string, content: string): Promise<string> {
    const fullPath = this.validatePath(inputPath)
    const dir = path.dirname(fullPath)
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    
    fs.writeFileSync(fullPath, content, 'utf-8')
    return `Created: ${inputPath}`
  }

  /**
   * Delete a file or directory
   */
  async delete(inputPath: string): Promise<string> {
    const fullPath = this.validatePath(inputPath)
    const stats = fs.statSync(fullPath)
    
    if (stats.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true })
    } else {
      fs.unlinkSync(fullPath)
    }
    
    return `Deleted: ${inputPath}`
  }

  /**
   * Check if a file/directory exists
   */
  async exists(inputPath: string): Promise<boolean> {
    try {
      const fullPath = this.validatePath(inputPath)
      return fs.existsSync(fullPath)
    } catch {
      return false
    }
  }

  /**
   * List all files in a directory recursively
   */
  async listAll(inputPath: string = '.'): Promise<string[]> {
    const fullPath = this.validatePath(inputPath)
    const results: string[] = []
    
    function walkDir(dir: string, prefix: string = '') {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      
      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
        
        if (entry.isDirectory()) {
          walkDir(path.join(dir, entry.name), relativePath)
        } else {
          results.push(relativePath)
        }
      }
    }
    
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      walkDir(fullPath)
    }
    
    return results
  }
}

export default MemoryStore
