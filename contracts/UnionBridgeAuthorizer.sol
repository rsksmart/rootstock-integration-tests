// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MultiSigLib
 * @dev Library for multisig membership management (add/remove) and simple voting on operations.
 * Uses simple-majority threshold based on current members. The multisig version increments on
 * membership changes, when proposals expire and are cleared, and when an operation vote is approved. It is used to invalidate ongoing votes when the state changes.
 */
library MultiSigLib {
    uint256 private constant MINIMUM_MEMBERS_REQUIRED_SIZE = 3;
    uint256 private constant MINIMUM_VOTING_PERIOD_IN_BLOCKS = 10;

    // Custom Errors
    error InsufficientMembers(uint256 provided, uint256 required);
    error InsufficientVotingPeriod(uint256 provided, uint256 required);

    error ZeroAddress();
    error CandidateAlreadyAMember(address member);
    error SenderNotAMember(address member);
    error CandidateNotAMember(address member);
    error SenderAlreadyVoted(address voter);
    error CannotRemoveBelowMinimum();

    error MembershipVotingInProgress(MembershipProposalType proposalType, address candidate);
    error OperationVotingInProgress(bytes32 voteKey);

    // Events
    event MultisigInitialized(address[] members, uint256 memberSize, uint256 votingThreshold, uint256 version);

    event MembershipVotingStarted(
        MembershipProposalType indexed proposalType, address indexed candidate, uint256 expiresAtBlock
    );
    event MembershipVotingExpired(
        MembershipProposalType indexed proposalType, address indexed candidate, uint256 expiresAtBlock
    );
    event OperationVotingExpired(bytes32 indexed voteKey, uint256 expiresAtBlock);

    event AddMemberCandidateVoted(address indexed candidate, address indexed voter);
    event RemoveMemberCandidateVoted(address indexed candidate, address indexed voter);

    event MemberAdded(address indexed member, uint256 multisigVersion);
    event MemberRemoved(address indexed member, uint256 multisigVersion);

    enum MembershipProposalType {
        None,
        Add,
        Remove
    }

    struct MembershipVoting {
        MembershipProposalType proposalType;
        address candidate;
        uint256 expiresAtBlock;
        uint256 votes;
        // Maps member address -> multisig version when they voted (prevents duplicate votes per version)
        mapping(address => uint256) memberVoteVersion;
    }

    struct OperationVoting {
        bytes32 voteKey;
        uint256 expiresAtBlock;
        uint256 votes;
        // Maps member address -> multisig version when they voted (prevents duplicate votes per version)
        mapping(address => uint256) memberVoteVersion;
    }

    struct State {
        mapping(address => bool) members;
        uint256 membersSize;
        uint256 votingThreshold;
        uint256 version;
        uint256 votingPeriodInBlocks;
        MembershipVoting currentMembershipVoting;
        OperationVoting currentOperationVoting;
    }

    /**
     * @dev Initializes the multisig state with the initial members and voting period.
     * @param state The multisig state storage to initialize.
     * @param initialMembers Array of addresses to be set as initial members.
     * @param votingPeriodInBlocks Voting period (in blocks) applied to all proposals (membership and operations).
     * @notice Requirements:
     * - The initial members list must contain at least 3 members.
     * - No duplicate members are allowed.
     * - Zero address is not allowed to be a member.
     * - The voting period must be at least the minimum required by the library.
     * @notice Effects:
     * - Sets initial members in the state.
     * - Sets initial multisig version to 1.
     * - Sets initial voting threshold based on member count (simple majority: floor(n/2)+1).
     * - Stores the `votingPeriodInBlocks` to be used for all proposals.
     * - Emits {MultisigInitialized} with members, size, threshold and version.
     * @custom:error InsufficientMembers When initial members count is below minimum.
     * @custom:error InsufficientVotingPeriod When `votingPeriodInBlocks` is below the minimum allowed.
     * @custom:error ZeroAddress When any member address is zero.
     * @custom:error CandidateAlreadyAMember When there are duplicate members.
     */
    function init(State storage state, address[] memory initialMembers, uint256 votingPeriodInBlocks) internal {
        if (initialMembers.length < MINIMUM_MEMBERS_REQUIRED_SIZE) {
            revert InsufficientMembers(initialMembers.length, MINIMUM_MEMBERS_REQUIRED_SIZE);
        }
        if (votingPeriodInBlocks < MINIMUM_VOTING_PERIOD_IN_BLOCKS) {
            revert InsufficientVotingPeriod(votingPeriodInBlocks, MINIMUM_VOTING_PERIOD_IN_BLOCKS);
        }

        state.version = 1;
        state.votingPeriodInBlocks = votingPeriodInBlocks;
        uint256 initialMembersSize = initialMembers.length;
        state.membersSize = initialMembersSize;

        for (uint256 i = 0; i < initialMembersSize; i++) {
            address candidateMember = initialMembers[i];
            _validateNewMemberCandidate(state, candidateMember);

            state.members[candidateMember] = true;
        }

        _updateVotingThreshold(state);

        emit MultisigInitialized(initialMembers, state.membersSize, state.votingThreshold, state.version);
    }

    // Membership view functions
    /**
     * @dev Returns true if `memberAddress` is currently a multisig member.
     * @param state The multisig state storage.
     * @param memberAddress The address to check for membership.
     */
    function isMember(State storage state, address memberAddress) internal view returns (bool) {
        return state.members[memberAddress];
    }

    /**
     * @dev Returns the current number of members in the multisig.
     * @param state The multisig state storage.
     */
    function getMembersSize(State storage state) internal view returns (uint256) {
        return state.membersSize;
    }

    /**
     * @dev Returns the current voting threshold (simple majority: floor(size/2)+1).
     * @param state The multisig state storage.
     */
    function getVotingThreshold(State storage state) internal view returns (uint256) {
        return state.votingThreshold;
    }

    /**
     * @dev Returns the current multisig version. The version increments on membership changes,
     * when proposals expire and are cleared, and when an operation vote is approved.
     * @param state The multisig state storage.
     */
    function getMultisigVersion(State storage state) internal view returns (uint256) {
        return state.version;
    }

    /**
     * @dev Returns the type of the current membership voting proposal.
     * Returns `MembershipProposalType.None` when no proposal is active.
     * @param state The multisig state storage.
     */
    function getCurrentMembershipVotingType(State storage state) internal view returns (MembershipProposalType) {
        return state.currentMembershipVoting.proposalType;
    }

    /**
     * @dev Returns the candidate address of the active membership voting proposal.
     * Returns `address(0)` if no proposal is active.
     * @param state The multisig state storage.
     */
    function getCurrentMembershipVotingCandidate(State storage state) internal view returns (address) {
        return state.currentMembershipVoting.candidate;
    }

    /**
     * @dev Returns the current number of votes for the active membership proposal.
     * Returns 0 if there is no active proposal.
     * @param state The multisig state storage.
     */
    function getCurrentMembershipVotingCount(State storage state) internal view returns (uint256) {
        return state.currentMembershipVoting.votes;
    }

    /**
     * @dev Returns true if `member` has already voted in the current multisig `version` for
     * the active membership proposal.
     * @param state The multisig state storage.
     * @param member The member address to query.
     */
    function hasMemberVotedMembership(State storage state, address member) internal view returns (bool) {
        return state.currentMembershipVoting.memberVoteVersion[member] == state.version;
    }

    /**
     * @dev Returns the block number when the current membership voting proposal expires.
     * @param state The multisig state storage.
     */
    function getCurrentMembershipVotingExpirationBlock(State storage state) internal view returns (uint256) {
        return state.currentMembershipVoting.expiresAtBlock;
    }

    // Operation voting view functions
    /**
     * @dev Returns the current operation voting key. Returns 0x0 when no operation voting is active.
     * @param state The multisig state storage.
     */
    function getCurrentOperationVotingKey(State storage state) internal view returns (bytes32) {
        return state.currentOperationVoting.voteKey;
    }

    /**
     * @dev Returns the current number of votes for the active operation vote. Returns 0 when none.
     * @param state The multisig state storage.
     */
    function getCurrentOperationVotingCount(State storage state) internal view returns (uint256) {
        return state.currentOperationVoting.votes;
    }

    /**
     * @dev Returns the block when the current operation voting expires. Returns 0 when none.
     * @param state The multisig state storage.
     */
    function getCurrentOperationVotingExpirationBlock(State storage state) internal view returns (uint256) {
        return state.currentOperationVoting.expiresAtBlock;
    }

    /**
     * @dev Returns true if `member` has voted in the current multisig version on the active operation vote.
     * @param state The multisig state storage.
     * @param member The member address to query.
     */
    function hasMemberVotedToOperation(State storage state, address member) internal view returns (bool) {
        return state.currentOperationVoting.memberVoteVersion[member] == state.version;
    }

    /**
     * @dev Casts a vote to add a new member to the multisig. Starts a new membership
     * proposal if none is active, otherwise requires voting on the same ongoing proposal.
     * @param state The multisig state storage.
     * @param candidate The address of the candidate to be added as a member.
     * @notice Requirements:
     * - The caller must be a current member.
     * - `candidate` must be non-zero and not already a member.
     * - Each member can vote only once per multisig version (votes tracked by version).
     * - If another membership proposal is active for a different candidate or type, the call reverts.
     * - If the active proposal has expired, it will be cleared and a new proposal can start.
     * @notice Effects:
     * - Starts an Add-member proposal if none is active and sets expiry at `block.number + votingPeriodInBlocks`.
     * - Records the caller's vote and emits {AddMemberCandidateVoted}.
     * - When votes reach the threshold, adds `candidate`, increments multisig `version`,
     *   updates the voting threshold (simple majority) and clears the proposal; emits {MemberAdded}.
     * - When an expired proposal is encountered, emits {MembershipVotingExpired} and clears it.
     * @custom:error SenderNotAMember The caller is not a current member.
     * @custom:error ZeroAddress `candidate` is the zero address.
     * @custom:error CandidateAlreadyAMember `candidate` is already a member.
     * @custom:error SenderAlreadyVoted The caller has already voted in the current version for this proposal.
     * @custom:error MembershipVotingInProgress Another membership proposal is currently active for a different candidate/type.
     */
    function voteToAddNewMember(State storage state, address candidate) internal {
        _validateSender(state);
        _validateNewMemberCandidate(state, candidate);

        _voteOnMembershipProposal(state, MembershipProposalType.Add, candidate);
        emit AddMemberCandidateVoted(candidate, msg.sender);

        if (state.currentMembershipVoting.votes == state.votingThreshold) {
            _executeAddMember(state, candidate);
        }
    }

    /**
     * @dev Casts a vote to remove an existing member from the multisig. Starts a new membership
     * proposal if none is active, otherwise requires voting on the same ongoing proposal.
     * @param state The multisig state storage.
     * @param candidate The address of the member proposed to be removed.
     * @notice Requirements:
     * - The caller must be a current member.
     * - `candidate` must be an existing member.
     * - The multisig cannot be reduced below the minimum required members (3).
     * - Each member can vote only once per multisig version (votes tracked by version).
     * - If another membership proposal is active for a different candidate or type, the call reverts.
     * - If the active proposal has expired, it will be cleared and a new proposal can start.
     * @notice Effects:
     * - Starts a Remove-member proposal if none is active and sets an expiry at `block.number + votingPeriodInBlocks`.
     * - Records the caller's vote and emits {RemoveMemberCandidateVoted}.
     * - When votes reach the threshold, removes `candidate`, increments multisig `version`,
     *   updates the voting threshold (simple majority) and clears the proposal; emits {MemberRemoved}.
     * - When an expired proposal is encountered, emits {MembershipVotingExpired} and clears it.
     * @custom:error SenderNotAMember The caller is not a current member.
     * @custom:error CandidateNotAMember `candidate` is not a member.
     * @custom:error CannotRemoveBelowMinimum Removing would drop members below the minimum allowed.
     * @custom:error SenderAlreadyVoted The caller has already voted in the current version for this proposal.
     * @custom:error MembershipVotingInProgress Another membership proposal is currently active for a different candidate/type.
     */
    function voteToRemoveMember(State storage state, address candidate) internal {
        _validateSender(state);
        _validateExistingMember(state, candidate);
        // Enforce minimum members: cannot reduce below required size
        if (state.membersSize == MINIMUM_MEMBERS_REQUIRED_SIZE) {
            revert CannotRemoveBelowMinimum();
        }

        _voteOnMembershipProposal(state, MembershipProposalType.Remove, candidate);
        emit RemoveMemberCandidateVoted(candidate, msg.sender);

        if (state.currentMembershipVoting.votes == state.votingThreshold) {
            _executeRemoveMember(state, candidate);
        }
    }

    function _voteOnMembershipProposal(State storage state, MembershipProposalType proposalType, address candidate)
    private
    {
        _validateMembershipVotingState(state, proposalType, candidate);
        _startNewMembershipProposalIfNone(state, proposalType, candidate);
        _recordMembershipProposalVote(state, msg.sender);
    }

    /**
     * @dev Starts a new membership proposal only if none.
     * This function assumes such validation has already been performed by callers.
     * @param state The multisig state storage.
     * @param proposalType The type of the membership proposal to start (Add or Remove).
     * @param candidate The address of the candidate targeted by the proposal.
     */
    function _startNewMembershipProposalIfNone(
        State storage state,
        MembershipProposalType proposalType,
        address candidate
    ) private {
        bool shouldStartNewMembershipProposal =
            state.currentMembershipVoting.proposalType == MembershipProposalType.None;
        if (shouldStartNewMembershipProposal) {
            _startNewMembershipProposal(state, proposalType, candidate);
        }
    }

    /**
     * @dev Updates the voting threshold based on the current `membersSize`.
     * Uses simple majority: `floor(membersSize/2) + 1`.
     * @param state The multisig state storage.
     */
    function _updateVotingThreshold(State storage state) private {
        state.votingThreshold = state.membersSize / 2 + 1;
    }

    /**
     * @dev Validates that `sender` is a current member.
     * @param state The multisig state storage.
     * @custom:error SenderNotAMember Thrown when `sender` is not part of the multisig.
     */
    function _validateSender(State storage state) private view {
        if (!state.members[msg.sender]) {
            revert SenderNotAMember(msg.sender);
        }
    }

    /**
     * @dev Validates that `candidate` is valid to be added as a new member.
     * @param state The multisig state storage.
     * @param candidate The address to validate.
     * @custom:error ZeroAddress Thrown when `candidate` is the zero address.
     * @custom:error CandidateAlreadyAMember Thrown when `candidate` is already a member.
     */
    function _validateNewMemberCandidate(State storage state, address candidate) private view {
        if (candidate == address(0)) {
            revert ZeroAddress();
        }
        if (state.members[candidate]) {
            revert CandidateAlreadyAMember(candidate);
        }
    }

    /**
     * @dev Validates that `member` is a current member.
     * @param state The multisig state storage.
     * @param member The address to validate.
     * @custom:error CandidateNotAMember Thrown when `member` is not part of the multisig.
     */
    function _validateExistingMember(State storage state, address member) private view {
        if (!state.members[member]) {
            revert CandidateNotAMember(member);
        }
    }

    /**
     * @dev Ensures a new vote can proceed for the given `proposalType` and `candidate`.
     * - If there is no active proposal, allows starting a new one.
     * - If an active proposal has expired, emits {MembershipVotingExpired}, clears it, and allows a new one.
     * - If a different proposal is in progress (different type or candidate) and not expired, reverts.
     * @param state The multisig state storage.
     * @param proposalType The type of membership proposal (Add or Remove).
     * @param candidate The candidate address the proposal targets.
     * @custom:error MembershipVotingInProgress Thrown when another non-expired proposal is active for a different
     * candidate or type.
     */
    function _validateMembershipVotingState(State storage state, MembershipProposalType proposalType, address candidate)
    private
    {
        _revertIfOperationVotingIsActive(state);

        MembershipVoting storage currentVoting = state.currentMembershipVoting;
        // No active voting yet — allow starting a new one
        if (_isMembershipVotingCleared(state)) {
            return;
        }

        bool isVoteForCurrentVoting = currentVoting.proposalType == proposalType && currentVoting.candidate == candidate;
        if (!isVoteForCurrentVoting) {
            revert MembershipVotingInProgress(currentVoting.proposalType, currentVoting.candidate);
        }
    }

    function _clearExpiredMembershipVoting(State storage state) private {
        MembershipVoting storage currentVoting = state.currentMembershipVoting;
        state.version++;
        emit MembershipVotingExpired(currentVoting.proposalType, currentVoting.candidate, currentVoting.expiresAtBlock);
        _clearCurrentMembershipVoting(state);
    }

    function _revertIfOperationVotingIsActive(State storage state) private {
        if (_isOperationVotingCleared(state)) {
            return;
        }
        revert OperationVotingInProgress(state.currentOperationVoting.voteKey);
    }

    function _isOperationVotingCleared(State storage state) private returns (bool) {
        OperationVoting storage currentVoting = state.currentOperationVoting;
        if (currentVoting.voteKey == bytes32(0)) {
            return true;
        }

        if (block.number >= currentVoting.expiresAtBlock) {
            _clearExpiredOperationVoting(state);
            return true;
        }
        return false;
    }

    /**
     * @dev Starts a new membership proposal of `proposalType` for `candidate`.
     * Sets the expiration to `block.number + state.votingPeriodInBlocks` and resets votes to 0.
     * Emits {MembershipVotingStarted}.
     * @param state The multisig state storage.
     * @param proposalType The type of the membership proposal (Add or Remove).
     * @param candidate The address being proposed.
     */
    function _startNewMembershipProposal(State storage state, MembershipProposalType proposalType, address candidate)
    private
    {
        MembershipVoting storage membershipVoting = state.currentMembershipVoting;
        membershipVoting.proposalType = proposalType;
        membershipVoting.candidate = candidate;
        membershipVoting.expiresAtBlock = block.number + state.votingPeriodInBlocks;

        emit MembershipVotingStarted(proposalType, candidate, membershipVoting.expiresAtBlock);
    }

    /**
     * @dev Clears the current membership voting proposal and resets its fields.
     * Sets type to `None`, candidate to `address(0)`, expiration and votes to 0.
     * @param state The multisig state storage.
     */
    function _clearCurrentMembershipVoting(State storage state) private {
        delete state.currentMembershipVoting;
    }

    /**
     * @dev Records a vote from `voter` for the current membership proposal.
     * Uses the multisig `version` to prevent duplicate votes per version.
     * Increments the vote count upon success.
     * @param state The multisig state storage.
     * @param voter The address of the voting member.
     * @custom:error SenderAlreadyVoted Thrown if `voter` already voted in the current version.
     */
    function _recordMembershipProposalVote(State storage state, address voter) private {
        MembershipVoting storage currentMembershipVoting = state.currentMembershipVoting;

        if (currentMembershipVoting.memberVoteVersion[voter] == state.version) {
            revert SenderAlreadyVoted(voter);
        }
        currentMembershipVoting.memberVoteVersion[voter] = state.version;
        currentMembershipVoting.votes += 1;
    }

    /**
     * @dev Executes the addition of a new member after the voting threshold is reached.
     * Increases `membersSize`, increments `version`, updates the voting threshold,
     * clears the current membership proposal, and emits {MemberAdded}.
     * @param state The multisig state storage.
     * @param candidate The address being added as a member.
     */
    function _executeAddMember(State storage state, address candidate) private {
        state.members[candidate] = true;
        state.membersSize++;
        _updateMultisigState(state);
        emit MemberAdded(candidate, state.version);
    }

    /**
     * @dev Executes the removal of a member after the voting threshold is reached.
     * Decreases `membersSize`, increments `version`, updates the voting threshold,
     * clears the current membership proposal, and emits {MemberRemoved}.
     * @param state The multisig state storage.
     * @param member The address being removed as a member.
     */
    function _executeRemoveMember(State storage state, address member) private {
        state.members[member] = false;
        state.membersSize--;
        _updateMultisigState(state);
        emit MemberRemoved(member, state.version);
    }

    /**
     * @dev Finalizes membership changes by updating multisig-wide state.
     * Increments the `version` to invalidate prior votes, recalculates the
     * `votingThreshold` based on the new `membersSize`, and clears any active
     * membership voting proposal.
     * @param state The multisig state storage.
     */
    function _updateMultisigState(State storage state) internal {
        state.version++;
        _updateVotingThreshold(state);
        _clearCurrentMembershipVoting(state);
    }

    /**
     * @dev Casts a vote to authorize an operation identified by `voteKey`.
     * Starts a new operation voting if none is active, otherwise requires voting on the same `voteKey`.
     * Reuses multisig versioning, expiration and threshold logic. May emit
     * {MembershipVotingExpired} or {OperationVotingExpired} when clearing expired proposals.
     * @param state The multisig state storage.
     * @param voteKey Operation identifier (domain-specific hash).
     * @return shouldExecute True when threshold is reached and the operation should execute.
     * Note: membership voting and operation voting are mutually exclusive while active.
     */
    function voteOnOperation(State storage state, bytes32 voteKey) internal returns (bool) {
        _validateSender(state);
        _validateOperationVotingState(state, voteKey);
        _startNewOperationProposalIfNone(state, voteKey);
        _recordOperationVote(state, msg.sender);

        if (state.currentOperationVoting.votes == state.votingThreshold) {
            state.version++;
            _clearCurrentOperationVoting(state);
            return true;
        }
        return false;
    }

    function _validateOperationVotingState(State storage state, bytes32 voteKey) private {
        _revertIfMembershipVotingIsActive(state);

        OperationVoting storage currentOperationVoting = state.currentOperationVoting;
        if (_isOperationVotingCleared(state)) {
            return;
        }

        bool isVoteForCurrentVoteKey = currentOperationVoting.voteKey == voteKey;
        if (!isVoteForCurrentVoteKey) {
            revert OperationVotingInProgress(currentOperationVoting.voteKey);
        }
    }

    function _isMembershipVotingCleared(State storage state) private returns (bool) {
        MembershipVoting storage currentVoting = state.currentMembershipVoting;
        if (currentVoting.proposalType == MembershipProposalType.None) {
            return true;
        }

        if (block.number >= currentVoting.expiresAtBlock) {
            _clearExpiredMembershipVoting(state);
            return true;
        }
        return false;
    }

    function _revertIfMembershipVotingIsActive(State storage state) private {
        MembershipVoting storage currentMembershipVoting = state.currentMembershipVoting;
        if (_isMembershipVotingCleared(state)) {
            return;
        }

        revert MembershipVotingInProgress(currentMembershipVoting.proposalType, currentMembershipVoting.candidate);
    }

    function _clearExpiredOperationVoting(State storage state) private {
        OperationVoting storage currentVoting = state.currentOperationVoting;
        state.version++;
        emit OperationVotingExpired(currentVoting.voteKey, currentVoting.expiresAtBlock);
        _clearCurrentOperationVoting(state);
    }

    function _startNewOperationProposalIfNone(State storage state, bytes32 voteKey) private {
        if (state.currentOperationVoting.voteKey == bytes32(0)) {
            _startNewOperationProposal(state, voteKey);
        }
    }

    function _startNewOperationProposal(State storage state, bytes32 voteKey) private {
        OperationVoting storage operationVoting = state.currentOperationVoting;
        operationVoting.voteKey = voteKey;
        operationVoting.expiresAtBlock = block.number + state.votingPeriodInBlocks;
    }

    function _clearCurrentOperationVoting(State storage state) private {
        delete state.currentOperationVoting;
    }

    function _recordOperationVote(State storage state, address voter) private {
        OperationVoting storage operationVoting = state.currentOperationVoting;
        if (operationVoting.memberVoteVersion[voter] == state.version) {
            revert SenderAlreadyVoted(voter);
        }
        operationVoting.memberVoteVersion[voter] = state.version;
        operationVoting.votes += 1;
    }
}

library UnionResponseCode {
    int8 internal constant SUCCESS = 0;
    int8 internal constant UNAUTHORIZED_CALLER = -1;
    int8 internal constant INVALID_VALUE = -2;
    int8 internal constant REQUEST_DISABLED = -3;
    int8 internal constant RELEASE_DISABLED = -3;
    int8 internal constant GENERIC_ERROR = -10;
}


interface BridgeInterface {
    function increaseUnionBridgeLockingCap(uint256 newLockingCap) external returns (int256);
    function setUnionBridgeTransferPermissions(bool requestEnabled, bool releaseEnabled) external returns (int256);
}

/**
 * @title UnionBridgeAuthorizer
 * @notice A multisig authorizer that manages members and approves Union Bridge operations
 * (increase locking cap, set transfer permissions). Executes the target call once the voting
 * threshold is reached within the configured voting period.
 */
contract UnionBridgeAuthorizer {
    using MultiSigLib for MultiSigLib.State;

    address private constant BRIDGE_ADDRESS = 0x0000000000000000000000000000000001000006;

    enum OperationType {
        IncreaseUnionLockingCap,
        SetUnionTransferPermissions
    }

    // ==== Errors ====
    error AlreadyInitialized();
    error NotInitialized();
    error BridgeCallFailed(int256 responseCode);
    error NotOwner();

    // ==== Modifiers ====
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyInitialized() {
        if (!_initialized) revert NotInitialized();
        _;
    }

    // ==== Events ====
    event Initialized(address[] members, uint256 votingPeriodInBlocks);

    event IncreaseUnionLockingCapVoted(uint256 newLockingCap, address indexed voter);
    event IncreaseUnionLockingCapExecuted(uint256 newLockingCap, int256 responseCode);

    event SetUnionBridgeTransferPermissionsVoted(bool requestEnabled, bool releaseEnabled, address indexed voter);
    event SetUnionBridgeTransferPermissionsExecuted(bool requestEnabled, bool releaseEnabled, int256 responseCode);

    address public owner;
    MultiSigLib.State private multisigState;
    bool private _initialized;
    BridgeInterface private immutable bridge;

    /**
     * @notice Sets the owner of the contract and initializes the bridge interface.
     */
    constructor() {
        owner = msg.sender;
        bridge = BridgeInterface(BRIDGE_ADDRESS);
    }

    /**
     * @notice Initializes members and voting period. Callable only once by owner.
     * @param initialMembers Initial multisig members.
     * @param votingPeriodInBlocks Number of blocks a voting proposal remains open.
     */
    function init(address[] calldata initialMembers, uint256 votingPeriodInBlocks) external onlyOwner {
        if (_initialized) revert AlreadyInitialized();

        multisigState.init(initialMembers, votingPeriodInBlocks);
        _initialized = true;
        emit Initialized(initialMembers, votingPeriodInBlocks);
    }

    /**
     * @notice Vote to add a new multisig member.
     * @param candidate address proposed to be added as member.
     */
    function voteToAddNewMember(address candidate) external onlyInitialized {
        multisigState.voteToAddNewMember(candidate);
    }

    /**
     * @notice Vote to remove an existing multisig member.
     * @param member address proposed to be removed from members.
     */
    function voteToRemoveMember(address member) external onlyInitialized {
        multisigState.voteToRemoveMember(member);
    }

    /**
     * @notice Vote to increase the Union Bridge locking cap; executes once threshold is met.
     * @param newLockingCap New locking cap value.
     * @dev Emits IncreaseUnionBridgeLockingCapVoted and IncreaseUnionBridgeLockingCapExecuted on execution.
     */
    function voteToIncreaseUnionLockingCap(uint256 newLockingCap) external onlyInitialized {
        bytes32 voteKey = keccak256(abi.encodePacked(OperationType.IncreaseUnionLockingCap, newLockingCap));
        bool shouldExecute = multisigState.voteOnOperation(voteKey);
        emit IncreaseUnionLockingCapVoted(newLockingCap, msg.sender);

        if (shouldExecute) {
            int256 responseCode = bridge.increaseUnionBridgeLockingCap(newLockingCap);
            _revertWhenBridgeCallFails(responseCode);
            emit IncreaseUnionLockingCapExecuted(newLockingCap, responseCode);
        }
    }

    /**
     * @notice Vote to set Union Bridge transfer permissions; executes once threshold is met.
     * @param requestEnabled Allow or block requests for union RBTC.
     * @param releaseEnabled Allow or block releases of union RBTC.
     * @dev Emits SetUnionBridgeTransferPermissionsVoted and SetUnionBridgeTransferPermissionsExecuted on execution.
     */
    function voteToSetUnionTransferPermissions(bool requestEnabled, bool releaseEnabled) external onlyInitialized {
        bytes32 voteKey =
            keccak256(abi.encodePacked(OperationType.SetUnionTransferPermissions, requestEnabled, releaseEnabled));
        bool shouldExecute = multisigState.voteOnOperation(voteKey);
        emit SetUnionBridgeTransferPermissionsVoted(requestEnabled, releaseEnabled, msg.sender);

        if (shouldExecute) {
            int256 responseCode = bridge.setUnionBridgeTransferPermissions(requestEnabled, releaseEnabled);
            _revertWhenBridgeCallFails(responseCode);
            emit SetUnionBridgeTransferPermissionsExecuted(requestEnabled, releaseEnabled, responseCode);
        }
    }

    function _revertWhenBridgeCallFails(int256 responseCode) internal pure {
        if (responseCode != UnionResponseCode.SUCCESS) {
            revert BridgeCallFailed(responseCode);
        }
    }

    // ==== View functions ====
    function isMember(address possibleMember) external view returns (bool) {
        return multisigState.isMember(possibleMember);
    }

    function getMembersSize() external view returns (uint256) {
        return multisigState.getMembersSize();
    }

    function getVotingThreshold() external view returns (uint256) {
        return multisigState.getVotingThreshold();
    }

    function getMultisigVersion() external view returns (uint256) {
        return multisigState.getMultisigVersion();
    }

    // Membership voting getters
    function getCurrentMembershipVotingType() external view returns (MultiSigLib.MembershipProposalType) {
        return multisigState.getCurrentMembershipVotingType();
    }

    function getCurrentMembershipVotingCandidate() external view returns (address) {
        return multisigState.getCurrentMembershipVotingCandidate();
    }

    function getCurrentMembershipVotingCount() external view returns (uint256) {
        return multisigState.getCurrentMembershipVotingCount();
    }

    function hasMemberVotedMembership(address member) external view returns (bool) {
        return multisigState.hasMemberVotedMembership(member);
    }

    function getCurrentMembershipVotingExpirationBlock() external view returns (uint256) {
        return multisigState.getCurrentMembershipVotingExpirationBlock();
    }

    // Operation voting getters
    function getCurrentOperationVotingKey() external view returns (bytes32) {
        return multisigState.getCurrentOperationVotingKey();
    }

    function getCurrentOperationVotingCount() external view returns (uint256) {
        return multisigState.getCurrentOperationVotingCount();
    }

    function getCurrentOperationVotingExpirationBlock() external view returns (uint256) {
        return multisigState.getCurrentOperationVotingExpirationBlock();
    }

    function hasMemberVotedToOperation(address member) external view returns (bool) {
        return multisigState.hasMemberVotedToOperation(member);
    }
}
