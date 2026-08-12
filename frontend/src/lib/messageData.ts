import { User } from './types';

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: Date;
  read: boolean;
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
}

export interface Conversation {
  id: string;
  participants: string[];
  participantNames: string[];
  lastMessage: string;
  lastMessageTime: Date;
  unreadCount: number;
}

export const conversations: Conversation[] = [
  {
    id: 'conv1',
    participants: ['user1', 'user3'],
    participantNames: ['John Smith', 'Mike Wilson'],
    lastMessage: 'Thanks for the update on the TechCorp proposal',
    lastMessageTime: new Date('2025-10-13T16:30:00'),
    unreadCount: 2,
  },
  {
    id: 'conv2',
    participants: ['user1', 'user2'],
    participantNames: ['John Smith', 'Sarah Johnson'],
    lastMessage: 'Can you share the client meeting notes?',
    lastMessageTime: new Date('2025-10-13T14:20:00'),
    unreadCount: 0,
  },
  {
    id: 'conv3',
    participants: ['user1', 'user4'],
    participantNames: ['John Smith', 'Emily Davis'],
    lastMessage: 'Perfect, I\'ll review the contract',
    lastMessageTime: new Date('2025-10-13T09:15:00'),
    unreadCount: 1,
  },
  {
    id: 'conv4',
    participants: ['user1', 'user5'],
    participantNames: ['John Smith', 'Robert Taylor'],
    lastMessage: 'Meeting scheduled for tomorrow at 2 PM',
    lastMessageTime: new Date('2025-10-12T17:45:00'),
    unreadCount: 0,
  },
  {
    id: 'conv5',
    participants: ['user1', 'user6'],
    participantNames: ['John Smith', 'Admin User'],
    lastMessage: 'System updates completed successfully',
    lastMessageTime: new Date('2025-10-12T10:00:00'),
    unreadCount: 0,
  },
];

export const messages: Message[] = [
  {
    id: 'msg1',
    conversationId: 'conv1',
    senderId: 'user3',
    senderName: 'Mike Wilson',
    content: 'Hey John, can you send me the latest numbers for the TechCorp deal?',
    timestamp: new Date('2025-10-13T15:45:00'),
    read: true,
  },
  {
    id: 'msg2',
    conversationId: 'conv1',
    senderId: 'user1',
    senderName: 'John Smith',
    content: 'Sure thing! Here\'s the proposal document with all the details.',
    timestamp: new Date('2025-10-13T16:00:00'),
    read: true,
    attachments: [
      {
        id: 'att1',
        name: 'TechCorp_Proposal_Q1_2026.pdf',
        type: 'application/pdf',
        size: 2456789,
        url: '#',
      }
    ],
  },
  {
    id: 'msg3',
    conversationId: 'conv1',
    senderId: 'user3',
    senderName: 'Mike Wilson',
    content: 'Thanks for the update on the TechCorp proposal',
    timestamp: new Date('2025-10-13T16:30:00'),
    read: false,
  },
  {
    id: 'msg4',
    conversationId: 'conv2',
    senderId: 'user2',
    senderName: 'Sarah Johnson',
    content: 'Hi John, I saw you met with Healthcare Solutions yesterday. How did it go?',
    timestamp: new Date('2025-10-13T09:30:00'),
    read: true,
  },
  {
    id: 'msg5',
    conversationId: 'conv2',
    senderId: 'user1',
    senderName: 'John Smith',
    content: 'It went really well! They\'re interested in our nursing staff services.',
    timestamp: new Date('2025-10-13T10:15:00'),
    read: true,
  },
  {
    id: 'msg6',
    conversationId: 'conv2',
    senderId: 'user2',
    senderName: 'Sarah Johnson',
    content: 'Can you share the client meeting notes?',
    timestamp: new Date('2025-10-13T14:20:00'),
    read: true,
  },
  {
    id: 'msg7',
    conversationId: 'conv3',
    senderId: 'user4',
    senderName: 'Emily Davis',
    content: 'John, I need your input on the contract for Finance Partners',
    timestamp: new Date('2025-10-13T08:00:00'),
    read: true,
  },
  {
    id: 'msg8',
    conversationId: 'conv3',
    senderId: 'user1',
    senderName: 'John Smith',
    content: 'Let me take a look at the terms and get back to you',
    timestamp: new Date('2025-10-13T08:45:00'),
    read: true,
  },
  {
    id: 'msg9',
    conversationId: 'conv3',
    senderId: 'user4',
    senderName: 'Emily Davis',
    content: 'Perfect, I\'ll review the contract',
    timestamp: new Date('2025-10-13T09:15:00'),
    read: false,
  },
  {
    id: 'msg10',
    conversationId: 'conv4',
    senderId: 'user5',
    senderName: 'Robert Taylor',
    content: 'Meeting scheduled for tomorrow at 2 PM',
    timestamp: new Date('2025-10-12T17:45:00'),
    read: true,
  },
  {
    id: 'msg11',
    conversationId: 'conv5',
    senderId: 'user6',
    senderName: 'Admin User',
    content: 'System updates completed successfully',
    timestamp: new Date('2025-10-12T10:00:00'),
    read: true,
  },
];
