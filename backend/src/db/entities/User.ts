import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToOne, Index } from 'typeorm';
import { UserSettings } from './UserSettings';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  @Index()
  plexId!: string; // Used for external ID: plex ID, or "jellyfin:serverId:userId", or "emby:serverId:userId"

  @Column({ type: 'varchar', length: 255 })
  username!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email?: string;

  @Column({ type: 'text', nullable: true })
  thumb?: string;

  @Column({ type: 'text', nullable: true })
  title?: string;

  @Column({ type: 'text', nullable: true, select: false })
  plexToken?: string; // Only used for Plex users

  // Alias for avatar URL (used by Jellyfin/Emby)
  @Column({ type: 'text', nullable: true })
  avatarUrl?: string;

  @Column({ type: 'boolean', default: false })
  hasPassword!: boolean;

  @Column({ type: 'json', nullable: true })
  subscription?: {
    active: boolean;
    status: string;
    plan?: string;
  };

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToOne(() => UserSettings, settings => settings.user)
  settings?: UserSettings;
}