const mongoose = require('mongoose');
const { startIsolatedMongo } = require('../../../helpers/isolatedMongo');
const TeamsUserMapping = require('../../../../src/modules/integration/teamsChat/models/teamsUserMapping.model');
const TeamsChatMapping = require('../../../../src/modules/integration/teamsChat/models/teamsChatMapping.model');
const TeamsMessageMapping = require('../../../../src/modules/integration/teamsChat/models/teamsMessageMapping.model');
const teamsUserMappingRepository = require('../../../../src/modules/integration/teamsChat/repositories/teamsUserMapping.repository');
const teamsChatMappingRepository = require('../../../../src/modules/integration/teamsChat/repositories/teamsChatMapping.repository');
const teamsMessageMappingRepository = require('../../../../src/modules/integration/teamsChat/repositories/teamsMessageMapping.repository');
const { TEAMS_SYNC_DIRECTIONS, TEAMS_SYNC_STATUSES } = require('../../../../src/modules/integration/teamsChat/constants/teams.constants');

describe('Teams mapping repositories', () => {
  let mongo;

  beforeAll(async () => {
    mongo = await startIsolatedMongo('teams_mapping_repository_test');
    await Promise.all([
      TeamsUserMapping.init(),
      TeamsChatMapping.init(),
      TeamsMessageMapping.init(),
    ]);
  });

  afterAll(async () => {
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      TeamsUserMapping.deleteMany({}),
      TeamsChatMapping.deleteMany({}),
      TeamsMessageMapping.deleteMany({}),
    ]);
  });

  describe('TeamsUserMapping repository', () => {
    test('upserts and retrieves user mapping with refresh token', async () => {
      const accountId = new mongoose.Types.ObjectId();
      const entraUserId = 'entra-user-uuid-1';

      const created = await teamsUserMappingRepository.upsertMapping({
        accountId,
        entraUserId,
        email: 'user1@lngwork.co',
        displayName: 'User One',
        encryptedRefreshToken: 'enc-token-123',
      });

      expect(created).toBeTruthy();
      expect(created.entraUserId).toBe(entraUserId);
      expect(created.email).toBe('user1@lngwork.co');

      const byAccount = await teamsUserMappingRepository.findByAccountId(accountId);
      expect(byAccount.entraUserId).toBe(entraUserId);

      const byEntra = await teamsUserMappingRepository.findByEntraUserId(entraUserId);
      expect(byEntra.email).toBe('user1@lngwork.co');

      const withSecret = await teamsUserMappingRepository.getWithRefreshToken(entraUserId);
      expect(withSecret.encryptedRefreshToken).toBe('enc-token-123');

      await teamsUserMappingRepository.updateRefreshToken(entraUserId, 'updated-token-456');
      const updatedSecret = await teamsUserMappingRepository.getWithRefreshToken(entraUserId);
      expect(updatedSecret.encryptedRefreshToken).toBe('updated-token-456');
    });
  });

  describe('TeamsChatMapping repository', () => {
    test('creates and retrieves chat mapping by conversationId and participant Entra IDs', async () => {
      const conversationId = new mongoose.Types.ObjectId();
      const teamsChatId = '19:sample-teams-chat-id@unq.gbl.spaces';
      const user1 = 'entra-u1';
      const user2 = 'entra-u2';

      const mapping = await teamsChatMappingRepository.createOrUpdateMapping({
        conversationId,
        teamsChatId,
        participantEntraUserIds: [user1, user2],
        isExternal: false,
      });

      expect(mapping).toBeTruthy();
      expect(mapping.teamsChatId).toBe(teamsChatId);

      const byConv = await teamsChatMappingRepository.findByConversationId(conversationId);
      expect(byConv.teamsChatId).toBe(teamsChatId);

      const byTeams = await teamsChatMappingRepository.findByTeamsChatId(teamsChatId);
      expect(String(byTeams.conversationId)).toBe(String(conversationId));

      const byParticipants = await teamsChatMappingRepository.findByParticipantEntraUserIds(user2, user1);
      expect(byParticipants.teamsChatId).toBe(teamsChatId);
    });
  });

  describe('TeamsMessageMapping repository', () => {
    test('creates and retrieves message mapping with unique constraints', async () => {
      const lngMessageId = new mongoose.Types.ObjectId();
      const conversationId = new mongoose.Types.ObjectId();
      const teamsMessageId = '1690000000001';
      const teamsChatId = '19:chat-id@unq.gbl.spaces';

      const mapping = await teamsMessageMappingRepository.createMapping({
        lngMessageId,
        teamsMessageId,
        teamsChatId,
        conversationId,
        direction: TEAMS_SYNC_DIRECTIONS.OUTBOUND,
        status: TEAMS_SYNC_STATUSES.SYNCED,
      });

      expect(mapping).toBeTruthy();
      expect(mapping.teamsMessageId).toBe(teamsMessageId);
      expect(mapping.direction).toBe('OUTBOUND');

      const byLng = await teamsMessageMappingRepository.findByLngMessageId(lngMessageId);
      expect(byLng.teamsMessageId).toBe(teamsMessageId);

      const byTeams = await teamsMessageMappingRepository.findByTeamsMessageId(teamsMessageId);
      expect(String(byTeams.lngMessageId)).toBe(String(lngMessageId));

      await expect(teamsMessageMappingRepository.createMapping({
        lngMessageId: new mongoose.Types.ObjectId(),
        teamsMessageId,
        teamsChatId,
        conversationId,
        direction: TEAMS_SYNC_DIRECTIONS.INBOUND,
      })).resolves.toMatchObject({ _id: mapping._id });
    });
  });
});
